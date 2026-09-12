-- =============================================================================
-- Reach v3 — the "never mail" memory
--
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again: every statement is "if not exists" / "or replace", the
-- copy from the old relationships table skips rows it already copied, and
-- NOTHING is ever dropped or deleted. Your old tables (relationships,
-- campaigns, campaign_sends, ...) stay exactly as they are, as a backup.
--
-- Reach remembers three things, and nothing else:
--   never_mail          your clients, people who replied, and people who
--                       asked you to stop. Small. Loaded into the browser.
--   bounce_suppression  every address that ever bounced. Blocked forever.
--   sent_ledger         the bare email address of everyone you ever sent to
--                       (plus first/last date). No names, no companies.
--
-- The app only talks to the database through the reach_* functions at the
-- bottom of this file. Every write is one transaction and an upsert or
-- insert-on-conflict, so a retry or a double click can never create
-- duplicates.
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 0. Email normalisation — must match normEmail() in index.html exactly.
--    Trims spaces, non-breaking and zero-width characters, strips mailto:,
--    angle brackets, quotes, commas and semicolons, lowercases, and checks the
--    shape. Returns NULL when it is not an email address. No Gmail dot or
--    plus-alias rewriting: matching is on the exact address.
-- ----------------------------------------------------------------------------
create or replace function reach_norm_email(raw text) returns text
language plpgsql immutable as $$
declare
  s text;
  prev text;
  edge text := ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || '<>"''`,;';
  dom text;
begin
  if raw is null then return null; end if;
  s := regexp_replace(raw, '[\u200B\u200C\u200D\u2060\uFEFF]', '', 'g');
  s := regexp_replace(s, '[\u00A0\u2007\u202F]', ' ', 'g');
  loop
    prev := s;
    s := btrim(s, edge);
    if lower(left(s, 7)) = 'mailto:' then s := substr(s, 8); end if;
    exit when s = prev;
  end loop;
  s := lower(s);
  if s !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null; end if;
  dom := split_part(s, '@', 2);
  if dom ~ '(^\.|\.$|\.\.)' then return null; end if;
  return s;
end $$;

-- Array helper: normalised, distinct, valid addresses only.
create or replace function reach_norm_emails(p_emails text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct n order by n), '{}')
    from (select reach_norm_email(x) as n from unnest(coalesce(p_emails, '{}')) x) q
   where n is not null;
$$;


-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

-- These two already exist if you used Reach v2; on a fresh project they are
-- created here. Existing tables and their rows are left untouched.
create table if not exists sent_ledger (
  email_norm text primary key,
  email_domain text not null default '',
  first_sent_at date not null,
  last_sent_at date not null,
  send_count int not null default 1,
  first_campaign_id uuid,
  last_campaign_id uuid,
  replied boolean not null default false
);

create table if not exists bounce_suppression (
  email_norm text primary key,
  bounced_at date not null default current_date,
  campaign_id uuid
);

-- New: the people you must never cold-mail again.
create table if not exists never_mail (
  id uuid primary key default gen_random_uuid(),
  email_norm text not null default '',        -- '' for a client known only by company
  email_domain text not null default '',
  reason text not null check (reason in ('Client', 'Replied', 'Do not contact')),
  company_name text not null default '',
  contact_person text not null default '',
  note text not null default '',
  added_at date not null default current_date,
  source_id uuid unique,                      -- the relationships.id it was copied from
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint never_mail_identity check (email_norm <> '' or company_name <> '')
);
create unique index if not exists never_mail_email_uq on never_mail (email_norm) where email_norm <> '';
create index if not exists never_mail_domain_idx on never_mail (email_domain);
create index if not exists never_mail_reason_idx on never_mail (reason);

-- Email is always stored normalised; the domain is derived from it.
create or replace function reach_never_mail_before() returns trigger language plpgsql as $$
begin
  new.email_norm := coalesce(reach_norm_email(new.email_norm), '');
  new.email_domain := case when new.email_norm <> '' then split_part(new.email_norm, '@', 2) else '' end;
  new.company_name := btrim(coalesce(new.company_name, ''));
  new.contact_person := btrim(coalesce(new.contact_person, ''));
  new.note := btrim(coalesce(new.note, ''));
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists never_mail_before on never_mail;
create trigger never_mail_before before insert or update on never_mail
  for each row execute function reach_never_mail_before();


-- ----------------------------------------------------------------------------
-- 2. One-time copy from the old relationships table (Reach v2).
--    Active / Past Client -> Client, Do Not Contact -> Do not contact,
--    everyone else who replied (In Conversation, Declined, Redirected)
--    -> Replied. The old status and your latest note go into the note.
--    If one address appears on several old rows, Client wins, then
--    Do not contact, then Replied. Rows with neither an email nor a company
--    can't be matched against anything and are skipped (they stay in the old
--    table). Running this again copies nothing twice.
-- ----------------------------------------------------------------------------
do $$
declare v int;
begin
  if to_regclass('public.relationships') is null then
    raise notice 'No old relationships table: nothing to copy.';
    return;
  end if;
  execute $q$
    with src as (
      select r.id, coalesce(reach_norm_email(r.email), '') as e, btrim(coalesce(r.company_name, '')) as company,
             btrim(coalesce(r.contact_person, '')) as contact, r.status, r.revisit_after, r.created_at,
             case r.status when 'Active Client' then 1 when 'Past Client' then 2 when 'Do Not Contact' then 3 else 4 end as pri,
             (select regexp_replace(n.note, '\s*\[ref:[0-9a-f-]{8,}\]', '', 'gi')
                from relationship_notes n
               where n.relationship_id = r.id and not n.auto
               order by n.created_at desc limit 1) as last_note
        from relationships r
    ), picked as (
      select distinct on (case when e <> '' then e else id::text end) *
        from src
       where e <> '' or company <> ''
       order by case when e <> '' then e else id::text end, pri, created_at
    )
    insert into never_mail (email_norm, reason, company_name, contact_person, note, added_at, source_id, created_at)
    select p.e,
           case when p.pri <= 2 then 'Client' when p.pri = 3 then 'Do not contact' else 'Replied' end,
           p.company, p.contact,
           left('Old Reach status: ' || p.status
                || coalesce(', revisit after ' || to_char(p.revisit_after, 'YYYY-MM-DD'), '')
                || coalesce('. ' || nullif(btrim(p.last_note), ''), ''), 2000),
           coalesce(p.created_at::date, current_date), p.id, coalesce(p.created_at, now())
      from picked p
     where not exists (select 1 from never_mail n where n.source_id = p.id)
       and not exists (select 1 from never_mail n where p.e <> '' and n.email_norm = p.e)
       and not exists (select 1 from never_mail n where p.e = '' and n.email_norm = '' and lower(n.company_name) = lower(p.company))
    on conflict do nothing
  $q$;
  get diagnostics v = row_count;
  raise notice 'Copied % people from the old relationships table.', v;
end $$;


-- ----------------------------------------------------------------------------
-- 3. Check a list (read only). Takes up to ~500 addresses per call and
--    returns only the ones Reach knows something about, keyed by the exact
--    string that was sent in.
-- ----------------------------------------------------------------------------
create or replace function reach_check(p_emails text[]) returns jsonb
language sql stable as $$
  with e as (
    select distinct x as input, reach_norm_email(x) as email
      from unnest(coalesce(p_emails, '{}')) x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'input', e.input,
      'email', e.email,
      'person', case when n.id is not null then jsonb_build_object(
                  'id', n.id, 'reason', n.reason, 'company_name', n.company_name,
                  'contact_person', n.contact_person, 'note', n.note, 'added_at', n.added_at) end,
      'bounced_at', b.bounced_at,
      'mailed', case when l.email_norm is not null then jsonb_build_object(
                  'first', l.first_sent_at, 'last', l.last_sent_at, 'count', l.send_count) end
    )), '[]'::jsonb)
  from e
  left join never_mail n         on n.email_norm = e.email
  left join bounce_suppression b on b.email_norm = e.email
  left join sent_ledger l        on l.email_norm = e.email
  where e.email is not null
    and (n.id is not null or b.email_norm is not null or l.email_norm is not null);
$$;


-- ----------------------------------------------------------------------------
-- 4. Bounces — blocked forever.
-- ----------------------------------------------------------------------------
create or replace function reach_add_bounces(p_emails text[]) returns jsonb
language plpgsql as $$
declare
  v_valid text[] := reach_norm_emails(p_emails);
  v_invalid int;
  v_added text[];
begin
  select count(*) into v_invalid from unnest(coalesce(p_emails, '{}')) x where reach_norm_email(x) is null;
  with ins as (
    insert into bounce_suppression (email_norm, bounced_at)
    select e, current_date from unnest(v_valid) e
    on conflict (email_norm) do nothing
    returning email_norm
  )
  select coalesce(array_agg(email_norm order by email_norm), '{}') into v_added from ins;
  return jsonb_build_object(
    'added',   to_jsonb(v_added),
    'already', cardinality(v_valid) - cardinality(v_added),
    'invalid', v_invalid,
    'total',   (select count(*) from bounce_suppression));
end $$;

-- Only for fixing a mistake (or undoing the add you just made).
create or replace function reach_remove_bounces(p_emails text[]) returns jsonb
language plpgsql as $$
declare v int;
begin
  delete from bounce_suppression where email_norm = any(reach_norm_emails(p_emails));
  get diagnostics v = row_count;
  return jsonb_build_object('removed', v);
end $$;

create or replace function reach_bounces_page(p_q text default '', p_offset int default 0, p_limit int default 50)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', (select count(*) from bounce_suppression b
               where coalesce(p_q, '') = '' or b.email_norm like '%' || lower(btrim(p_q)) || '%'),
    'rows', coalesce((select jsonb_agg(x) from (
        select b.email_norm as email, b.bounced_at
          from bounce_suppression b
         where coalesce(p_q, '') = '' or b.email_norm like '%' || lower(btrim(p_q)) || '%'
         order by b.bounced_at desc, b.email_norm
        offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 500)) x), '[]'::jsonb));
$$;


-- ----------------------------------------------------------------------------
-- 5. Mailed memory — bare addresses and dates, nothing else.
--    Remembering the same address for the same date twice changes nothing,
--    so pressing "I sent this" twice can never double count.
-- ----------------------------------------------------------------------------
create or replace function reach_remember_sent(p_emails text[], p_sent_at date default null)
returns jsonb language plpgsql as $$
declare
  v_date date := coalesce(p_sent_at, current_date);
  v_valid text[] := reach_norm_emails(p_emails);
  v_invalid int;
  v_prev jsonb;
  v_created text[];
  v_updated int;
begin
  select count(*) into v_invalid from unnest(coalesce(p_emails, '{}')) x where reach_norm_email(x) is null;

  -- Exact previous values of every row this call is about to change, handed
  -- back so the app can undo it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'email_norm', l.email_norm, 'first_sent_at', l.first_sent_at, 'last_sent_at', l.last_sent_at,
           'send_count', l.send_count, 'first_campaign_id', l.first_campaign_id, 'last_campaign_id', l.last_campaign_id)), '[]'::jsonb)
    into v_prev
    from sent_ledger l
   where l.email_norm = any(v_valid) and v_date <> l.first_sent_at and v_date <> l.last_sent_at;

  with up as (
    insert into sent_ledger (email_norm, email_domain, first_sent_at, last_sent_at, send_count)
    select e, split_part(e, '@', 2), v_date, v_date, 1 from unnest(v_valid) e
    on conflict (email_norm) do update set
      send_count        = sent_ledger.send_count + 1,
      first_campaign_id = case when excluded.first_sent_at < sent_ledger.first_sent_at then null else sent_ledger.first_campaign_id end,
      last_campaign_id  = case when excluded.last_sent_at  > sent_ledger.last_sent_at  then null else sent_ledger.last_campaign_id end,
      first_sent_at     = least(sent_ledger.first_sent_at, excluded.first_sent_at),
      last_sent_at      = greatest(sent_ledger.last_sent_at, excluded.last_sent_at)
    where excluded.first_sent_at <> sent_ledger.first_sent_at
      and excluded.first_sent_at <> sent_ledger.last_sent_at
    returning email_norm, (xmax = 0) as created
  )
  select coalesce(array_agg(email_norm order by email_norm) filter (where created), '{}'),
         count(*) filter (where not created)
    into v_created, v_updated
    from up;

  return jsonb_build_object(
    'created',   to_jsonb(v_created),
    'prev',      v_prev,
    'added',     cardinality(v_created),
    'updated',   v_updated,
    'unchanged', cardinality(v_valid) - cardinality(v_created) - v_updated,
    'invalid',   v_invalid);
end $$;

-- Undo the call above: rows it created are removed, rows it changed get
-- their exact previous values back.
create or replace function reach_undo_sent(p_created text[], p_prev jsonb)
returns jsonb language plpgsql as $$
declare v_removed int; v_restored int;
begin
  delete from sent_ledger where email_norm = any(coalesce(p_created, '{}'));
  get diagnostics v_removed = row_count;
  update sent_ledger l set
    first_sent_at     = (p->>'first_sent_at')::date,
    last_sent_at      = (p->>'last_sent_at')::date,
    send_count        = (p->>'send_count')::int,
    first_campaign_id = nullif(p->>'first_campaign_id', '')::uuid,
    last_campaign_id  = nullif(p->>'last_campaign_id', '')::uuid
  from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) p
  where l.email_norm = p->>'email_norm';
  get diagnostics v_restored = row_count;
  return jsonb_build_object('removed', v_removed, 'restored', v_restored);
end $$;

-- Forget one address entirely (a genuine mistake only).
create or replace function reach_forget_sent(p_email text) returns jsonb
language plpgsql as $$
declare v int;
begin
  delete from sent_ledger where email_norm = reach_norm_email(p_email);
  get diagnostics v = row_count;
  return jsonb_build_object('removed', v);
end $$;


-- ----------------------------------------------------------------------------
-- 6. People (clients, replied, do not contact)
-- ----------------------------------------------------------------------------
create or replace function reach_people() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(n) - 'source_id'
           order by n.reason, lower(n.company_name), lower(n.contact_person), n.email_norm), '[]'::jsonb)
    from never_mail n;
$$;

-- Add many people at once. p_rows: [{email, company, contact, note}, ...].
-- With p_commit = false nothing is written: you get back exactly what would
-- happen (add / change reason / already there / invalid), so the app can
-- show it before you confirm. With p_commit = true the same plan is applied
-- in one transaction.
--   * a row needs a valid email, except a Client, which may be a company only
--   * an address already in memory with another reason moves to the new one
--   * empty company / contact fields get filled in, nothing is overwritten
create or replace function reach_save_people(p_rows jsonb, p_reason text, p_commit boolean default false)
returns jsonb language plpgsql as $$
declare
  v_plan jsonb;
begin
  if p_reason is null or p_reason not in ('Client', 'Replied', 'Do not contact') then
    raise exception 'Unknown reason: %', p_reason;
  end if;

  with raw as (
    select t.ord,
           btrim(coalesce(t.x->>'email', ''))   as email_raw,
           reach_norm_email(t.x->>'email')      as e,
           btrim(coalesce(t.x->>'company', '')) as company,
           btrim(coalesce(t.x->>'contact', '')) as contact,
           btrim(coalesce(t.x->>'note', ''))    as note
      from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end)
           with ordinality as t(x, ord)
  ), keyed as (
    select raw.*,
           case when e is not null then 'e:' || e
                when email_raw = '' and p_reason = 'Client' and company <> '' then 'c:' || lower(company)
           end as k
      from raw
  ), firsts as (
    select distinct on (k) * from keyed where k is not null order by k, ord
  ), matched as (
    select f.*, n.id as existing_id, n.reason as existing_reason
      from firsts f
      left join never_mail n
        on (f.e is not null and n.email_norm = f.e)
        or (f.e is null and n.email_norm = '' and lower(n.company_name) = lower(f.company))
  )
  select jsonb_build_object(
    'add',     coalesce((select jsonb_agg(jsonb_build_object('email', coalesce(e, ''), 'company', company, 'contact', contact, 'note', note) order by ord)
                           from matched where existing_id is null), '[]'::jsonb),
    'change',  coalesce((select jsonb_agg(jsonb_build_object('id', existing_id, 'email', coalesce(e, ''), 'company', company, 'contact', contact, 'note', note, 'from', existing_reason) order by ord)
                           from matched where existing_id is not null and existing_reason <> p_reason), '[]'::jsonb),
    'same',    coalesce((select jsonb_agg(jsonb_build_object('id', existing_id, 'email', coalesce(e, ''), 'company', company, 'contact', contact, 'note', note) order by ord)
                           from matched where existing_id is not null and existing_reason = p_reason), '[]'::jsonb),
    'invalid', coalesce((select jsonb_agg(case when email_raw <> '' then email_raw else nullif(btrim(company || ' ' || contact), '') end order by ord)
                           from keyed where k is null and (email_raw <> '' or company <> '' or contact <> '')), '[]'::jsonb),
    'repeats', (select count(*) from keyed where k is not null) - (select count(*) from firsts)
  ) into v_plan;

  if p_commit then
    insert into never_mail (email_norm, reason, company_name, contact_person, note)
    select x->>'email', p_reason, x->>'company', x->>'contact', x->>'note'
      from jsonb_array_elements(v_plan->'add') x
    on conflict do nothing;

    update never_mail n set
      reason         = p_reason,
      company_name   = case when n.company_name = ''   then x->>'company' else n.company_name end,
      contact_person = case when n.contact_person = '' then x->>'contact' else n.contact_person end,
      note           = case when x->>'note' = '' or position(x->>'note' in n.note) > 0 then n.note
                            when n.note = '' then x->>'note'
                            else n.note || E'\n' || (x->>'note') end
      from jsonb_array_elements((v_plan->'change') || (v_plan->'same')) x
     where n.id = (x->>'id')::uuid;
  end if;

  return v_plan || jsonb_build_object('committed', p_commit);
end $$;

-- Edit one person. p: {reason, email, company_name, contact_person, note}
create or replace function reach_update_person(p_id uuid, p jsonb) returns jsonb
language plpgsql as $$
declare
  v_email text;
  v_other never_mail%rowtype;
  v_row never_mail%rowtype;
begin
  if p ? 'email' then
    v_email := coalesce(reach_norm_email(p->>'email'), '');
    if btrim(coalesce(p->>'email', '')) <> '' and v_email = '' then
      raise exception 'Not a valid email address: %', p->>'email';
    end if;
    if v_email <> '' then
      select * into v_other from never_mail where email_norm = v_email and id <> p_id;
      if found then raise exception '% is already in memory as %', v_email, v_other.reason; end if;
    end if;
  end if;
  update never_mail set
    reason         = coalesce(p->>'reason', reason),
    email_norm     = case when p ? 'email' then v_email else email_norm end,
    company_name   = coalesce(p->>'company_name', company_name),
    contact_person = coalesce(p->>'contact_person', contact_person),
    note           = coalesce(p->>'note', note)
  where id = p_id
  returning * into v_row;
  if not found then raise exception 'That person is no longer in memory'; end if;
  return to_jsonb(v_row) - 'source_id';
end $$;

create or replace function reach_delete_person(p_id uuid) returns jsonb
language plpgsql as $$
declare v_row never_mail%rowtype;
begin
  delete from never_mail where id = p_id returning * into v_row;
  if not found then return null; end if;
  return to_jsonb(v_row);
end $$;

-- Put back a person that was just deleted (the Undo button).
create or replace function reach_restore_person(p jsonb) returns jsonb
language plpgsql as $$
declare v_row never_mail%rowtype;
begin
  insert into never_mail select * from jsonb_populate_record(null::never_mail, p)
  on conflict do nothing
  returning * into v_row;
  if not found then raise exception 'Could not restore: that address is already in memory again'; end if;
  return to_jsonb(v_row) - 'source_id';
end $$;


-- ----------------------------------------------------------------------------
-- 7. Counts and backup
-- ----------------------------------------------------------------------------
create or replace function reach_counts() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'Client',         (select count(*) from never_mail where reason = 'Client'),
    'Replied',        (select count(*) from never_mail where reason = 'Replied'),
    'Do not contact', (select count(*) from never_mail where reason = 'Do not contact'),
    'bounced',        (select count(*) from bounce_suppression),
    'mailed',         (select count(*) from sent_ledger));
$$;

-- Keyset paged, so a full backup never times out. p_kind: 'bounced' | 'mailed'
create or replace function reach_backup_page(p_kind text, p_after text default null, p_limit int default 2000)
returns jsonb language plpgsql stable as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 2000), 1), 5000);
  r jsonb;
begin
  if p_kind = 'bounced' then
    select coalesce(jsonb_agg(jsonb_build_object('email', b.email_norm, 'bounced_at', b.bounced_at) order by b.email_norm), '[]'::jsonb) into r
      from (select * from bounce_suppression where p_after is null or email_norm > p_after order by email_norm limit v_lim) b;
  elsif p_kind = 'mailed' then
    select coalesce(jsonb_agg(jsonb_build_object('email', l.email_norm, 'first_sent_at', l.first_sent_at,
                                                 'last_sent_at', l.last_sent_at, 'send_count', l.send_count) order by l.email_norm), '[]'::jsonb) into r
      from (select * from sent_ledger where p_after is null or email_norm > p_after order by email_norm limit v_lim) l;
  else
    raise exception 'Unknown backup kind: %', p_kind;
  end if;
  return r;
end $$;


-- ----------------------------------------------------------------------------
-- 8. Access. Same as before: if you ran security-lockdown.sql (signed-in
--    only), the new table and functions are locked down the same way;
--    otherwise they are open to the app's key like the rest of Reach.
-- ----------------------------------------------------------------------------
alter table never_mail enable row level security;
alter table sent_ledger enable row level security;
alter table bounce_suppression enable row level security;

do $$
declare
  locked boolean := exists (select 1 from pg_policies where schemaname = 'public' and policyname like 'signed in access %');
  t text;
  f record;
begin
  foreach t in array array['never_mail', 'sent_ledger', 'bounce_suppression'] loop
    if locked then
      execute format('drop policy if exists %I on %I', 'public access ' || t, t);
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'signed in access ' || t) then
        execute format('create policy %I on %I for all to authenticated using (true) with check (true)', 'signed in access ' || t, t);
      end if;
    elsif not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute format('create policy %I on %I for all using (true) with check (true)', 'public access ' || t, t);
    end if;
  end loop;

  if locked then
    for f in
      select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'reach\_%'
    loop
      execute format('revoke execute on function %s from public, anon', f.sig);
      execute format('grant execute on function %s to authenticated', f.sig);
    end loop;
  end if;
end $$;

-- Tell the API about the new table and functions straight away.
notify pgrst, 'reload schema';
