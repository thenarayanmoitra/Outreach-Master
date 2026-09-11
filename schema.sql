-- =============================================================================
-- Reach — schema v2 (Reach Restructure, Logic Spec v1, 11 Sep 2026)
--
-- Run this whole file once in Supabase: Database > SQL Editor > New query.
-- It is safe to re-run: every statement is "create if not exists" or
-- "create or replace", and it never touches the old leads / lead_notes tables.
-- The move from the old leads table is done from inside the app
-- (Settings > Migrate from old leads table), which calls the migration_*
-- functions at the bottom of this file.
--
-- Data is split by value:
--   relationships + relationship_notes  people who actually replied. Small,
--                                        loaded fully into the browser.
--   sent_ledger                          one row per address ever mailed.
--   campaign_sends                       which address was in which campaign.
--   bounce_suppression                   every address ever removed as bounced.
--   campaigns                            one row per outreach batch + counters.
--   campaign_replies                     helper: one row per person per campaign
--                                        that replied, so reply_count can never
--                                        be counted twice.
-- The ledger tables are never loaded in bulk; the app queries them through the
-- functions below, one round trip per batch.
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 0. Email normalisation — must match normEmail() in index.html exactly.
--    Returns the normalised address, or NULL when the shape is invalid.
--    No Gmail dot removal, no plus-alias stripping: exact address matching.
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
  -- zero-width characters vanish; non-breaking spaces become plain spaces
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


-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

-- 1.5 campaigns — kept from v1, mail_count renamed to sent_count, counters added
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null default current_date,
  sent_count int not null default 0,
  status text not null default 'Completed' check (status in ('Scheduled','In Progress','Completed','Paused')),
  response text default '',
  created_at timestamptz not null default now()
);
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'campaigns' and column_name = 'mail_count')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'campaigns' and column_name = 'sent_count') then
    alter table campaigns rename column mail_count to sent_count;
  end if;
end $$;
alter table campaigns add column if not exists sent_count int not null default 0;
alter table campaigns add column if not exists bounce_count int not null default 0;
alter table campaigns add column if not exists reply_count int not null default 0;
alter table campaigns add column if not exists source_sheet text not null default '';
create index if not exists campaigns_date_idx on campaigns (date);

-- 1.1 relationships — anyone who sent a real human reply. Never deleted by any
-- automated action (the only delete path is delete_relationship(), one record
-- at a time, behind a typed confirmation in the app).
create table if not exists relationships (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default '',
  company_name_clean text not null default '',
  contact_person text not null default '',
  email text not null default '',
  email_norm text not null default '',
  email_domain text not null default '',
  status text not null default 'In Conversation' check (status in
    ('Active Client','Past Client','In Conversation','Declined','Redirected','Do Not Contact')),
  source_campaign_id uuid references campaigns(id) on delete set null,
  replied_at date default current_date,
  revisit_after date,
  email_bounced boolean not null default false,
  last_contacted date,
  next_follow_up date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationships_identity check (company_name <> '' or contact_person <> '' or email <> '')
);
create index if not exists relationships_email_norm_idx on relationships (email_norm);
create index if not exists relationships_company_clean_idx on relationships (company_name_clean);
create index if not exists relationships_domain_idx on relationships (email_domain);
create index if not exists relationships_status_idx on relationships (status);
create index if not exists relationships_source_campaign_idx on relationships (source_campaign_id);

-- 1.2 relationship_notes — same as lead_notes, renamed. auto = written by the
-- system (status changes, bounces, reply logging) rather than typed by you.
create table if not exists relationship_notes (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references relationships(id) on delete cascade,
  note text not null,
  auto boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
-- clock_timestamp, not now(): several notes written in one transaction (a
-- reply plus its referral) must keep their order on the timeline.
alter table relationship_notes alter column created_at set default clock_timestamp();
create index if not exists relationship_notes_rel_idx on relationship_notes (relationship_id);

-- 1.3 sent_ledger — one ~100 byte row per unique address ever mailed.
-- Deliberately no name, company or notes.
create table if not exists sent_ledger (
  email_norm text primary key,
  email_domain text not null default '',
  first_sent_at date not null,
  last_sent_at date not null,
  send_count int not null default 1,
  first_campaign_id uuid references campaigns(id) on delete set null,
  last_campaign_id uuid references campaigns(id) on delete set null,
  replied boolean not null default false
);
create index if not exists sent_ledger_domain_idx on sent_ledger (email_domain);
create index if not exists sent_ledger_first_campaign_idx on sent_ledger (first_campaign_id);
create index if not exists sent_ledger_last_campaign_idx on sent_ledger (last_campaign_id);

-- 1.4 campaign_sends — which address was in which campaign.
create table if not exists campaign_sends (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email_norm text not null,
  sent_at date not null default current_date,
  constraint campaign_sends_unique unique (campaign_id, email_norm)
);
create index if not exists campaign_sends_email_idx on campaign_sends (email_norm);
create index if not exists campaign_sends_sent_at_idx on campaign_sends (sent_at);

-- 1.6 bounce_suppression — every address ever removed as bounced. Keeps a dead
-- address from coming back as "New" the next time it shows up in a sheet.
create table if not exists bounce_suppression (
  email_norm text primary key,
  bounced_at date not null default current_date,
  campaign_id uuid references campaigns(id) on delete set null
);
create index if not exists bounce_suppression_campaign_idx on bounce_suppression (campaign_id);

-- Helper: one row per (campaign, person) that replied. reply_count is always
-- recomputed from this table, so logging the same person twice can never
-- count twice.
create table if not exists campaign_replies (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email_norm text not null,
  relationship_id uuid references relationships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, email_norm)
);
create index if not exists campaign_replies_rel_idx on campaign_replies (relationship_id);
create index if not exists campaign_replies_email_idx on campaign_replies (email_norm);


-- ----------------------------------------------------------------------------
-- 2. Triggers on relationships
-- ----------------------------------------------------------------------------

-- Email is always stored normalised; email_norm and email_domain are derived.
create or replace function reach_rel_before() returns trigger language plpgsql as $$
begin
  new.email := btrim(coalesce(new.email, ''));
  new.email_norm := coalesce(reach_norm_email(new.email), '');
  if new.email_norm <> '' then new.email := new.email_norm; end if;
  new.email_domain := case when new.email_norm <> '' then split_part(new.email_norm, '@', 2) else '' end;
  new.company_name := coalesce(new.company_name, '');
  new.contact_person := coalesce(new.contact_person, '');
  new.company_name_clean := coalesce(new.company_name_clean, '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists relationships_before on relationships;
create trigger relationships_before before insert or update on relationships
  for each row execute function reach_rel_before();

-- Every status change writes an automatic timeline note, whichever surface
-- made the change (grid, board, bulk edit, detail panel).
create or replace function reach_rel_status_note() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into relationship_notes (relationship_id, note, auto)
    values (new.id, 'Status changed from ' || old.status || ' to ' || new.status, true);
  end if;
  return new;
end $$;
drop trigger if exists relationships_status_note on relationships;
create trigger relationships_status_note after update of status on relationships
  for each row execute function reach_rel_status_note();


-- ----------------------------------------------------------------------------
-- 3. Internal helpers
-- ----------------------------------------------------------------------------

-- Rebuild sent_ledger rows from what remains in campaign_sends. An address
-- with no campaign_sends left loses its ledger row entirely.
create or replace function reach_recompute_ledger(p_emails text[]) returns void
language plpgsql as $$
begin
  if p_emails is null or cardinality(p_emails) = 0 then return; end if;
  delete from sent_ledger l
   where l.email_norm = any(p_emails)
     and not exists (select 1 from campaign_sends s where s.email_norm = l.email_norm);
  update sent_ledger l set
    send_count        = a.n,
    first_sent_at     = a.first_at,
    last_sent_at      = a.last_at,
    first_campaign_id = a.first_c,
    last_campaign_id  = a.last_c
  from (
    select s.email_norm,
           count(*)::int as n,
           min(s.sent_at) as first_at,
           max(s.sent_at) as last_at,
           (array_agg(s.campaign_id order by s.sent_at asc,  c.created_at asc))[1]  as first_c,
           (array_agg(s.campaign_id order by s.sent_at desc, c.created_at desc))[1] as last_c
      from campaign_sends s join campaigns c on c.id = s.campaign_id
     where s.email_norm = any(p_emails)
     group by s.email_norm
  ) a
  where l.email_norm = a.email_norm;
end $$;

create or replace function reach_recount_campaign(p_campaign_id uuid) returns void
language sql as $$
  update campaigns set
    sent_count  = (select count(*) from campaign_sends   s where s.campaign_id = p_campaign_id),
    reply_count = (select count(*) from campaign_replies r where r.campaign_id = p_campaign_id)
  where id = p_campaign_id;
$$;


-- ----------------------------------------------------------------------------
-- 4. Check (read only) — spec 3.1 / 4.4
-- ----------------------------------------------------------------------------

-- Takes up to ~500 normalised addresses, returns only the ones found in the
-- ledger or the suppression list. Never returns anything else.
create or replace function check_emails(p_emails text[]) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'email',                e.email_norm,
      'send_count',           l.send_count,
      'first_sent_at',        l.first_sent_at,
      'last_sent_at',         l.last_sent_at,
      'last_campaign_id',     l.last_campaign_id,
      'last_campaign_name',   lc.name,
      'replied',              l.replied,
      'bounced_at',           b.bounced_at,
      'bounce_campaign_id',   b.campaign_id,
      'bounce_campaign_name', bc.name
    )), '[]'::jsonb)
  from (select distinct unnest(p_emails) as email_norm) e
  left join sent_ledger l        on l.email_norm = e.email_norm
  left join bounce_suppression b on b.email_norm = e.email_norm
  left join campaigns lc         on lc.id = l.last_campaign_id
  left join campaigns bc         on bc.id = b.campaign_id
  where l.email_norm is not null or b.email_norm is not null;
$$;

-- Optional domain warning: which of these domains has anyone in the ledger.
create or replace function check_domains(p_domains text[]) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(d), '[]'::jsonb)
  from (select distinct email_domain as d from sent_ledger where email_domain = any(p_domains)) x;
$$;


-- ----------------------------------------------------------------------------
-- 5. Mark as Sent (writes) — spec 3.2. One transaction per call; every write
--    is an insert-on-conflict, so a duplicated or retried call can never
--    create duplicate rows or double count.
-- ----------------------------------------------------------------------------
create or replace function mark_sent(p_campaign_id uuid, p_emails text[], p_sent_at date default null)
returns jsonb language plpgsql as $$
declare
  v_date date := coalesce(p_sent_at, current_date);
  v_valid text[];
  v_invalid int;
  v_suppressed text[];
  v_inserted text[];
  v_prev jsonb;
  v_sent int;
begin
  if not exists (select 1 from campaigns where id = p_campaign_id) then
    raise exception 'Campaign % not found', p_campaign_id;
  end if;

  select coalesce(array_agg(distinct n) filter (where n is not null), '{}'),
         count(*) filter (where n is null)
    into v_valid, v_invalid
    from (select reach_norm_email(x) as n from unnest(p_emails) x) q;

  -- A suppressed address is dead: it is never written back into the ledger.
  select coalesce(array_agg(e), '{}') into v_suppressed
    from unnest(v_valid) e
   where exists (select 1 from bounce_suppression b where b.email_norm = e);
  v_valid := array(select e from unnest(v_valid) e where not (e = any(v_suppressed)));

  with ins as (
    insert into campaign_sends (campaign_id, email_norm, sent_at)
    select p_campaign_id, e, v_date from unnest(v_valid) e
    on conflict (campaign_id, email_norm) do nothing
    returning email_norm
  )
  select coalesce(array_agg(email_norm), '{}') into v_inserted from ins;

  -- Exact previous ledger values of every row this call is about to change,
  -- handed back to the app so "Undo last Mark as Sent" can restore them.
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_prev
    from sent_ledger l where l.email_norm = any(v_inserted);

  -- Only addresses newly added to this campaign touch the ledger, so marking
  -- the same list twice cannot bump send_count twice.
  insert into sent_ledger (email_norm, email_domain, first_sent_at, last_sent_at, send_count, first_campaign_id, last_campaign_id)
  select e, split_part(e, '@', 2), v_date, v_date, 1, p_campaign_id, p_campaign_id from unnest(v_inserted) e
  on conflict (email_norm) do update set
    send_count        = sent_ledger.send_count + 1,
    first_campaign_id = case when excluded.first_sent_at < sent_ledger.first_sent_at then excluded.first_campaign_id else sent_ledger.first_campaign_id end,
    first_sent_at     = least(sent_ledger.first_sent_at, excluded.first_sent_at),
    last_campaign_id  = case when excluded.last_sent_at >= sent_ledger.last_sent_at then excluded.last_campaign_id else sent_ledger.last_campaign_id end,
    last_sent_at      = greatest(sent_ledger.last_sent_at, excluded.last_sent_at);

  -- Set from the real row count, never by adding, so a retry can't double count.
  update campaigns set sent_count = (select count(*) from campaign_sends where campaign_id = p_campaign_id)
   where id = p_campaign_id
   returning sent_count into v_sent;

  return jsonb_build_object(
    'inserted',   to_jsonb(v_inserted),
    'prev',       v_prev,
    'added',      cardinality(v_inserted),
    'already',    cardinality(v_valid) - cardinality(v_inserted),
    'suppressed', cardinality(v_suppressed),
    'invalid',    v_invalid,
    'sent_count', v_sent
  );
end $$;

-- Undo last Mark as Sent (spec 11): reverses exactly the rows that call
-- inserted and restores the ledger rows it changed.
create or replace function undo_mark_sent(p_campaign_id uuid, p_emails text[], p_prev jsonb)
returns jsonb language plpgsql as $$
declare
  v_removed int;
  v_created text[];
begin
  delete from campaign_sends where campaign_id = p_campaign_id and email_norm = any(p_emails);
  get diagnostics v_removed = row_count;

  update sent_ledger l set
    first_sent_at     = (p->>'first_sent_at')::date,
    last_sent_at      = (p->>'last_sent_at')::date,
    send_count        = (p->>'send_count')::int,
    first_campaign_id = (select c.id from campaigns c where c.id = nullif(p->>'first_campaign_id', '')::uuid),
    last_campaign_id  = (select c.id from campaigns c where c.id = nullif(p->>'last_campaign_id', '')::uuid)
  from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) p
  where l.email_norm = p->>'email_norm';

  -- Rows that call created from nothing: gone again, unless another campaign
  -- has mailed them since, in which case they are rebuilt from campaign_sends.
  v_created := array(
    select e from unnest(p_emails) e
     where not exists (select 1 from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) p where p->>'email_norm' = e));
  perform reach_recompute_ledger(v_created);

  update campaigns set sent_count = (select count(*) from campaign_sends where campaign_id = p_campaign_id)
   where id = p_campaign_id;
  return jsonb_build_object('removed', v_removed);
end $$;


-- ----------------------------------------------------------------------------
-- 6. Bounce purge — spec 6
-- ----------------------------------------------------------------------------

-- Read-only preview: which of these addresses are in scope (one campaign, or
-- every campaign when p_campaign_id is null), and which are already suppressed.
create or replace function purge_preview(p_campaign_id uuid, p_emails text[]) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'found', coalesce((
      select jsonb_agg(jsonb_build_object('email', s.email_norm, 'campaign_id', s.campaign_id,
                                          'campaign_name', c.name, 'sent_at', s.sent_at)
                       order by s.email_norm, s.sent_at)
        from campaign_sends s join campaigns c on c.id = s.campaign_id
       where s.email_norm = any(p_emails)
         and (p_campaign_id is null or s.campaign_id = p_campaign_id)), '[]'::jsonb),
    'suppressed', coalesce((
      select jsonb_agg(b.email_norm) from bounce_suppression b where b.email_norm = any(p_emails)), '[]'::jsonb)
  );
$$;

-- p_emails are removed from p_campaign_id (or from every campaign when it is
-- null). p_all_emails are removed from every campaign regardless — used for
-- the "not found here, search all campaigns" group. One transaction.
create or replace function purge_bounces(p_campaign_id uuid, p_emails text[], p_all_emails text[] default '{}')
returns jsonb language plpgsql as $$
declare
  v_removed jsonb;
  v_emails text[];
  v_flagged int := 0;
begin
  with del as (
    delete from campaign_sends s
     where (s.email_norm = any(coalesce(p_emails, '{}')) and (p_campaign_id is null or s.campaign_id = p_campaign_id))
        or  s.email_norm = any(coalesce(p_all_emails, '{}'))
    returning s.campaign_id, s.email_norm, s.sent_at
  )
  select coalesce(jsonb_agg(to_jsonb(del)), '[]'::jsonb) into v_removed from del;

  v_emails := array(select distinct r->>'email_norm' from jsonb_array_elements(v_removed) r);
  if cardinality(v_emails) = 0 then
    return jsonb_build_object('removed', 0, 'emails', 0, 'relationships_flagged', 0);
  end if;

  -- sent_ledger: gone if nothing remains, otherwise rebuilt from what remains.
  perform reach_recompute_ledger(v_emails);

  -- bounce_suppression: the campaign it bounced in is the latest one it was removed from.
  insert into bounce_suppression (email_norm, bounced_at, campaign_id)
  select distinct on (r->>'email_norm') r->>'email_norm', current_date, (r->>'campaign_id')::uuid
    from jsonb_array_elements(v_removed) r
   order by r->>'email_norm', (r->>'sent_at')::date desc
  on conflict (email_norm) do update set bounced_at = excluded.bounced_at, campaign_id = excluded.campaign_id;

  -- campaigns: sent_count from the real rows, removed number added to bounce_count.
  update campaigns c set
    bounce_count = c.bounce_count + x.n,
    sent_count   = (select count(*) from campaign_sends s where s.campaign_id = c.id)
  from (select (r->>'campaign_id')::uuid as cid, count(*)::int as n
          from jsonb_array_elements(v_removed) r group by 1) x
  where c.id = x.cid;

  -- A bounced relationship is flagged, never deleted (spec 6.5).
  with flagged as (
    update relationships r set email_bounced = true
     where r.email_norm = any(v_emails)
    returning r.id, r.email_norm
  ), noted as (
    insert into relationship_notes (relationship_id, note, auto)
    select f.id, 'Email bounced in campaign ' || coalesce(c.name, '(unknown)') || ', likely changed role', true
      from flagged f
      left join bounce_suppression b on b.email_norm = f.email_norm
      left join campaigns c on c.id = b.campaign_id
    returning 1
  )
  select count(*) into v_flagged from noted;

  return jsonb_build_object(
    'removed', jsonb_array_length(v_removed),
    'emails', cardinality(v_emails),
    'relationships_flagged', v_flagged
  );
end $$;

create or replace function suppression_list(p_q text default '', p_offset int default 0, p_limit int default 50)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', (select count(*) from bounce_suppression b
               where coalesce(p_q, '') = '' or b.email_norm like '%' || lower(p_q) || '%'),
    'rows', coalesce((select jsonb_agg(x) from (
        select b.email_norm as email, b.bounced_at, b.campaign_id, c.name as campaign_name
          from bounce_suppression b left join campaigns c on c.id = b.campaign_id
         where coalesce(p_q, '') = '' or b.email_norm like '%' || lower(p_q) || '%'
         order by b.bounced_at desc, b.email_norm
         offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb)
  );
$$;

create or replace function suppression_remove(p_email text) returns jsonb
language plpgsql as $$
declare v int;
begin
  delete from bounce_suppression where email_norm = reach_norm_email(p_email);
  get diagnostics v = row_count;
  return jsonb_build_object('removed', v);
end $$;


-- ----------------------------------------------------------------------------
-- 7. Replies — spec 5
-- ----------------------------------------------------------------------------

-- Creates the referred person as a separate In Conversation row, with the
-- source campaign copied and a note on both rows linking them (spec 5.3).
-- A referral is not a reply, so it never touches reply_count.
create or replace function create_referral(p_from uuid, p jsonb) returns jsonb
language plpgsql as $$
declare
  v_from relationships%rowtype;
  v_id uuid;
  v_from_label text;
  v_to_label text;
begin
  select * into v_from from relationships where id = p_from;
  if not found then raise exception 'Relationship % not found', p_from; end if;
  insert into relationships (company_name, company_name_clean, contact_person, email, status, source_campaign_id, replied_at)
  values (coalesce(p->>'company_name', ''), coalesce(p->>'company_name_clean', ''), coalesce(p->>'contact_person', ''),
          coalesce(p->>'email', ''), 'In Conversation', v_from.source_campaign_id, current_date)
  returning id into v_id;
  v_from_label := coalesce(nullif(v_from.contact_person, ''), nullif(v_from.email, ''), v_from.company_name);
  v_to_label := coalesce(nullif(p->>'contact_person', ''), nullif(p->>'email', ''), p->>'company_name');
  insert into relationship_notes (relationship_id, note, auto) values
    (p_from, 'Redirected to ' || v_to_label || coalesce(' <' || nullif(p->>'email', '') || '>', '') || ' [ref:' || v_id || ']', true),
    (v_id, 'Referred by ' || v_from_label || coalesce(' <' || nullif(v_from.email, '') || '>', '') || ' [ref:' || p_from || ']', true);
  return jsonb_build_object('id', v_id);
end $$;

-- Log a reply (spec 5.1). p is a json object:
--   email, ledger_email (the address that was mailed, if the reply came from
--   another one), campaign_id, status, contact_person, company_name,
--   company_name_clean, note, revisit_after, referral {email, contact_person,
--   company_name, company_name_clean} when status is Redirected.
-- If the address already belongs to a relationship nothing is created and
-- {existing: id} is returned, so the app can open that record instead.
create or replace function log_reply(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_email text := coalesce(reach_norm_email(p->>'email'), '');
  v_ledger text := coalesce(reach_norm_email(p->>'ledger_email'), '');
  v_attr text;
  v_campaign uuid := nullif(p->>'campaign_id', '')::uuid;
  v_status text := coalesce(nullif(p->>'status', ''), 'In Conversation');
  v_existing uuid;
  v_id uuid;
  v_ref jsonb;
  v_cname text;
  v_counted int := 0;
begin
  if v_email <> '' then
    select id into v_existing from relationships where email_norm = v_email order by created_at limit 1;
    if v_existing is not null then return jsonb_build_object('existing', v_existing); end if;
  end if;
  if v_campaign is not null then select name into v_cname from campaigns where id = v_campaign; end if;

  insert into relationships (company_name, company_name_clean, contact_person, email, status,
                             source_campaign_id, replied_at, revisit_after, last_contacted)
  values (coalesce(p->>'company_name', ''), coalesce(p->>'company_name_clean', ''), coalesce(p->>'contact_person', ''),
          coalesce(p->>'email', ''), v_status, v_campaign,
          coalesce(nullif(p->>'replied_at', '')::date, current_date),
          nullif(p->>'revisit_after', '')::date,
          coalesce(nullif(p->>'replied_at', '')::date, current_date))
  returning id into v_id;

  insert into relationship_notes (relationship_id, note, auto)
  values (v_id, 'Reply logged' || coalesce(' from campaign ' || v_cname, ' (no campaign, inbound or referral)')
                || case when v_ledger <> '' and v_ledger <> v_email then ', mailed at ' || v_ledger else '' end
                || ', status ' || v_status, true);
  if coalesce(btrim(p->>'note'), '') <> '' then
    insert into relationship_notes (relationship_id, note, auto) values (v_id, btrim(p->>'note'), false);
  end if;

  -- sent_ledger.replied for the address that was mailed (and the reply address).
  update sent_ledger set replied = true
   where email_norm = any(array_remove(array[v_email, v_ledger], ''));

  -- reply_count: once per person per campaign, never twice.
  v_attr := coalesce(nullif(v_ledger, ''), nullif(v_email, ''), 'rel:' || v_id::text);
  if v_campaign is not null then
    insert into campaign_replies (campaign_id, email_norm, relationship_id)
    values (v_campaign, v_attr, v_id)
    on conflict (campaign_id, email_norm) do nothing;
    get diagnostics v_counted = row_count;
    update campaigns set reply_count = (select count(*) from campaign_replies where campaign_id = v_campaign)
     where id = v_campaign;
  end if;

  if v_status = 'Redirected' and jsonb_typeof(p->'referral') = 'object'
     and (coalesce(p->'referral'->>'email', '') <> '' or coalesce(p->'referral'->>'contact_person', '') <> ''
          or coalesce(p->'referral'->>'company_name', '') <> '') then
    v_ref := create_referral(v_id, p->'referral');
  end if;

  return jsonb_build_object('id', v_id, 'referral_id', v_ref->>'id', 'reply_counted', v_counted);
end $$;

-- Manual single-record delete, for genuine mistakes only. Keeps the campaign
-- reply counters and the ledger's replied flag truthful afterwards.
create or replace function delete_relationship(p_id uuid) returns jsonb
language plpgsql as $$
declare
  v_camps uuid[];
  v_emails text[];
  v_email text;
begin
  select coalesce(array_agg(distinct campaign_id), '{}'), coalesce(array_agg(distinct email_norm), '{}')
    into v_camps, v_emails from campaign_replies where relationship_id = p_id;
  select email_norm into v_email from relationships where id = p_id;
  delete from relationships where id = p_id;
  update campaigns c set reply_count = (select count(*) from campaign_replies r where r.campaign_id = c.id)
   where c.id = any(v_camps);
  update sent_ledger l set replied =
         exists (select 1 from relationships r where r.email_norm = l.email_norm)
      or exists (select 1 from campaign_replies cr where cr.email_norm = l.email_norm)
   where l.email_norm = any(array_remove(v_emails || coalesce(v_email, ''), ''));
  return jsonb_build_object('deleted', p_id);
end $$;


-- ----------------------------------------------------------------------------
-- 8. Campaigns
-- ----------------------------------------------------------------------------

-- Deleting a campaign (spec 11). Default keeps the ledger as is, since the
-- emails were still really sent; p_remove_from_ledger rebuilds those
-- addresses' ledger rows from their other campaigns (or removes them).
create or replace function delete_campaign(p_campaign_id uuid, p_remove_from_ledger boolean default false)
returns jsonb language plpgsql as $$
declare
  v_emails text[];
begin
  v_emails := array(select email_norm from campaign_sends where campaign_id = p_campaign_id);
  delete from campaigns where id = p_campaign_id;
  if p_remove_from_ledger then perform reach_recompute_ledger(v_emails); end if;
  return jsonb_build_object('sends', cardinality(v_emails), 'ledger_updated', p_remove_from_ledger);
end $$;

-- Campaign detail, paged (spec 9) — also feeds the Campaign Delivered export.
-- Suppressed addresses never appear.
create or replace function campaign_sends_page(p_campaign_id uuid, p_offset int default 0, p_limit int default 100, p_q text default '')
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', (select count(*) from campaign_sends s
               where s.campaign_id = p_campaign_id
                 and (coalesce(p_q, '') = '' or s.email_norm like '%' || lower(p_q) || '%')
                 and not exists (select 1 from bounce_suppression b where b.email_norm = s.email_norm)),
    'rows', coalesce((select jsonb_agg(x order by x.email) from (
        select s.email_norm as email, s.sent_at,
               (coalesce(l.replied, false)
                or exists (select 1 from campaign_replies cr where cr.campaign_id = s.campaign_id and cr.email_norm = s.email_norm)) as replied,
               (select r.status from relationships r where r.email_norm = s.email_norm order by r.created_at limit 1) as relationship_status
          from campaign_sends s
          left join sent_ledger l on l.email_norm = s.email_norm
         where s.campaign_id = p_campaign_id
           and (coalesce(p_q, '') = '' or s.email_norm like '%' || lower(p_q) || '%')
           and not exists (select 1 from bounce_suppression b where b.email_norm = s.email_norm)
         order by s.email_norm
        offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000)) x), '[]'::jsonb)
  );
$$;


-- ----------------------------------------------------------------------------
-- 9. Ledger lookups and exports
-- ----------------------------------------------------------------------------

-- Ledger search: one exact address, its whole history.
create or replace function ledger_lookup(p_email text) returns jsonb
language sql stable as $$
  with v as (select reach_norm_email(p_email) as e)
  select jsonb_build_object(
    'email', (select e from v),
    'ledger', (select to_jsonb(l) || jsonb_build_object('first_campaign_name', fc.name, 'last_campaign_name', lc.name)
                 from sent_ledger l
                 left join campaigns fc on fc.id = l.first_campaign_id
                 left join campaigns lc on lc.id = l.last_campaign_id
                where l.email_norm = (select e from v)),
    'sends', coalesce((select jsonb_agg(jsonb_build_object('campaign_id', s.campaign_id, 'campaign_name', c.name,
                                                           'sent_at', s.sent_at) order by s.sent_at desc)
                         from campaign_sends s join campaigns c on c.id = s.campaign_id
                        where s.email_norm = (select e from v)), '[]'::jsonb),
    'suppression', (select to_jsonb(b) || jsonb_build_object('campaign_name', c.name)
                      from bounce_suppression b left join campaigns c on c.id = b.campaign_id
                     where b.email_norm = (select e from v)),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('campaign_id', cr.campaign_id, 'campaign_name', c.name,
                                                             'created_at', cr.created_at))
                           from campaign_replies cr join campaigns c on c.id = cr.campaign_id
                          where cr.email_norm = (select e from v)), '[]'::jsonb)
  );
$$;

-- Full Ledger Backup (spec 7.4), keyset paged so it never times out.
-- Suppressed addresses are excluded, as in every export.
create or replace function export_ledger_page(p_after text default null, p_limit int default 1000)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'email', l.email_norm, 'first_sent_at', l.first_sent_at, 'last_sent_at', l.last_sent_at,
      'send_count', l.send_count, 'first_campaign', fc.name, 'last_campaign', lc.name, 'replied', l.replied)
    order by l.email_norm), '[]'::jsonb)
  from (select * from sent_ledger sl
         where (p_after is null or sl.email_norm > p_after)
           and not exists (select 1 from bounce_suppression b where b.email_norm = sl.email_norm)
         order by sl.email_norm
         limit least(greatest(p_limit, 1), 5000)) l
  left join campaigns fc on fc.id = l.first_campaign_id
  left join campaigns lc on lc.id = l.last_campaign_id;
$$;


-- ----------------------------------------------------------------------------
-- 10. Dashboard — spec 8. Every number is a count or aggregate; nothing
--     loads ledger rows.
-- ----------------------------------------------------------------------------
create or replace function dashboard_stats() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'ledger_total',     (select count(*) from sent_ledger),
    'ledger_replied',   (select count(*) from sent_ledger where replied),
    'suppressed_total', (select count(*) from bounce_suppression),
    'sent_this_month',  (select count(*) from campaign_sends
                          where sent_at >= date_trunc('month', current_date)::date),
    'sent_last_month',  (select count(*) from campaign_sends
                          where sent_at >= (date_trunc('month', current_date) - interval '1 month')::date
                            and sent_at <  date_trunc('month', current_date)::date),
    'sends_by_month',   coalesce((select jsonb_object_agg(m, n) from (
                            select to_char(sent_at, 'YYYY-MM') as m, count(*) as n
                              from campaign_sends
                             where sent_at >= (date_trunc('month', current_date) - interval '11 months')::date
                             group by 1) x), '{}'::jsonb),
    'by_status',        coalesce((select jsonb_object_agg(status, n) from (
                            select status, count(*) as n from relationships group by status) s), '{}'::jsonb),
    'relationships_total', (select count(*) from relationships),
    'conversion_converted', (select count(distinct relationship_id) from relationship_notes
                              where auto and note = 'Status changed from In Conversation to Active Client'),
    'conversion_pool',  (select count(*) from relationships r
                          where r.status = 'In Conversation'
                             or exists (select 1 from relationship_notes n
                                         where n.relationship_id = r.id and n.auto
                                           and n.note like 'Status changed from In Conversation to %'))
  );
$$;


-- ----------------------------------------------------------------------------
-- 11. Row level security. Single-user tool with no login screen by default,
--     same as v1: the anon key can read and write. To lock it down to your own
--     login, see security-lockdown.sql and set REQUIRE_LOGIN in index.html.
-- ----------------------------------------------------------------------------
alter table relationships      enable row level security;
alter table relationship_notes enable row level security;
alter table sent_ledger        enable row level security;
alter table campaign_sends     enable row level security;
alter table campaigns          enable row level security;
alter table bounce_suppression enable row level security;
alter table campaign_replies   enable row level security;

drop policy if exists "public access relationships"      on relationships;
drop policy if exists "public access relationship_notes" on relationship_notes;
drop policy if exists "public access sent_ledger"        on sent_ledger;
drop policy if exists "public access campaign_sends"     on campaign_sends;
drop policy if exists "public access campaigns"          on campaigns;
drop policy if exists "public access bounce_suppression" on bounce_suppression;
drop policy if exists "public access campaign_replies"   on campaign_replies;
create policy "public access relationships"      on relationships      for all using (true) with check (true);
create policy "public access relationship_notes" on relationship_notes for all using (true) with check (true);
create policy "public access sent_ledger"        on sent_ledger        for all using (true) with check (true);
create policy "public access campaign_sends"     on campaign_sends     for all using (true) with check (true);
create policy "public access campaigns"          on campaigns          for all using (true) with check (true);
create policy "public access bounce_suppression" on bounce_suppression for all using (true) with check (true);
create policy "public access campaign_replies"   on campaign_replies   for all using (true) with check (true);


-- =============================================================================
-- 12. Migration from the old leads table — spec 10.
--     Driven from the app (Settings > Migrate). Every step is chunked and
--     resumable, so no single call runs long enough to hit Supabase's
--     statement timeout, and a dropped connection just means "run it again".
--     These functions use dynamic SQL because the leads table may not exist.
-- =============================================================================

create table if not exists migration_decisions (
  lead_id uuid primary key,
  decision text not null check (decision in ('Active Client','Past Client','Declined','Do Not Contact','Ledger'))
);
alter table migration_decisions enable row level security;
drop policy if exists "public access migration_decisions" on migration_decisions;
create policy "public access migration_decisions" on migration_decisions for all using (true) with check (true);

create or replace function reach_legacy_campaign_name(p_src text) returns text
language sql immutable as $$ select 'Legacy, ' || coalesce(nullif(btrim(p_src), ''), 'Unlabeled') $$;

create or replace function migration_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_extra jsonb;
  v_has_mig boolean;
begin
  if to_regclass('public.leads') is null then
    return jsonb_build_object('legacy', false,
                              'relationships', (select count(*) from relationships),
                              'ledger', (select count(*) from sent_ledger));
  end if;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'mig_email')
    into v_has_mig;
  execute format($q$
    select jsonb_build_object(
      'legacy', true,
      'prepared', %1$L::boolean,
      'total', (select count(*) from leads),
      'notes', (select count(*) from lead_notes),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from leads group by status) s), '{}'::jsonb),
      'sheets', (select count(distinct coalesce(source_list, '')) from leads),
      'decisions', (select count(*) from migration_decisions),
      'copied', (select count(*) from relationships r where exists (select 1 from leads l where l.id = r.id)),
      'ledger_rows', (select count(*) from sent_ledger),
      'legacy_campaigns', (select count(*) from campaigns where name like 'Legacy, %%'),
      'old_campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'date', c.date, 'sent_count', c.sent_count,
                                   'superseded', exists (select 1 from leads l where coalesce(l.source_list, '') = c.name)) order by c.date desc)
                                   from campaigns c
                                  where c.name not like 'Legacy, %%'
                                    and not exists (select 1 from campaign_sends s where s.campaign_id = c.id)), '[]'::jsonb)
    ) $q$, v_has_mig) into r;
  if v_has_mig then
    execute $q$
      select jsonb_build_object(
        'ledger_bound_valid',   count(*) filter (where (l.status = 'Not Now' or d.decision = 'Ledger') and l.mig_email <> ''),
        'ledger_bound_emails',  count(distinct l.mig_email) filter (where (l.status = 'Not Now' or d.decision = 'Ledger') and l.mig_email <> ''),
        'ledger_bound_noemail', count(*) filter (where (l.status = 'Not Now' or d.decision = 'Ledger') and coalesce(l.mig_email, '') = ''),
        'stay',                 count(*) filter (where l.status <> 'Not Now' and coalesce(d.decision, '') <> 'Ledger'),
        'unprepared',           count(*) filter (where l.mig_email is null)
      ) from leads l left join migration_decisions d on d.lead_id = l.id $q$ into v_extra;
    r := r || v_extra;
  end if;
  return r;
end $$;

-- The review screen: every Won and Dead row, with its latest note.
create or replace function migration_review_rows() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if to_regclass('public.leads') is null then return '[]'::jsonb; end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'company_name', l.company_name, 'contact_person', l.contact_person, 'email', l.email,
        'status', l.status, 'source_list', l.source_list, 'last_contacted', l.last_contacted, 'date_added', l.date_added,
        'latest_note', (select n.note from lead_notes n where n.lead_id = l.id order by n.created_at desc limit 1),
        'decision', d.decision)
      order by l.status desc, lower(coalesce(nullif(l.company_name, ''), l.contact_person, l.email))), '[]'::jsonb)
    from leads l left join migration_decisions d on d.lead_id = l.id
    where l.status in ('Won', 'Dead') $q$ into r;
  return r;
end $$;

create or replace function migration_save_decisions(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into migration_decisions (lead_id, decision)
  select key::uuid, value #>> '{}' from jsonb_each(p)
  on conflict (lead_id) do update set decision = excluded.decision;
  get diagnostics v = row_count;
  return jsonb_build_object('saved', v);
end $$;

-- Step 1: snapshot the old tables before anything moves.
create or replace function migration_snapshot() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suffix text := to_char(now(), 'YYYYMMDD_HH24MISS');
  v_leads text := 'leads_snapshot_' || v_suffix;
  v_notes text := 'lead_notes_snapshot_' || v_suffix;
begin
  if to_regclass('public.leads') is null then raise exception 'No leads table to snapshot'; end if;
  execute format('create table %I as select * from leads', v_leads);
  execute format('create table %I as select * from lead_notes', v_notes);
  -- RLS on with no policy: invisible to the anon key.
  execute format('alter table %I enable row level security', v_leads);
  execute format('alter table %I enable row level security', v_notes);
  return jsonb_build_object('leads_table', v_leads, 'notes_table', v_notes);
end $$;

-- One chunk of one step. Returns {done, processed}. The app loops until done.
--   prep            add + fill leads.mig_email (normalised, '' when invalid)
--   campaigns       one "Legacy, <sheet>" campaign per old source_list value
--   ledger          Not Now rows (and Dead rows marked as ghosts) with a valid
--                   email -> sent_ledger + campaign_sends, then deleted from leads
--   archive_delete  the same rows with no valid email -> deleted (the app has
--                   already downloaded them, with notes, as Legacy_Archive csv)
--   relationships   every remaining row -> relationships (same id), notes
--                   copied, and a replied ledger + campaign_sends entry
--   counters        campaign sent_count / reply_count recomputed
create or replace function migration_step(p_step text, p_limit int default 1000) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
  v_lim int := least(greatest(coalesce(p_limit, 1000), 1), 5000);
begin
  if to_regclass('public.leads') is null then raise exception 'No leads table to migrate'; end if;

  if p_step = 'prep' then
    execute 'alter table leads add column if not exists mig_email text';
    execute 'create index if not exists leads_mig_email_idx on leads (mig_email)';
    execute format($q$
      update leads set mig_email = coalesce(reach_norm_email(email), '')
       where id in (select id from leads where mig_email is null limit %s) $q$, v_lim);
    get diagnostics v_n = row_count;
    return jsonb_build_object('done', v_n = 0, 'processed', v_n);

  elsif p_step = 'campaigns' then
    execute $q$
      insert into campaigns (name, date, status, source_sheet, response)
      select reach_legacy_campaign_name(src), d, 'Completed', src, 'Created by the Reach migration from the old leads table'
        from (select coalesce(source_list, '') as src,
                     coalesce(min(coalesce(last_contacted, date_added)), current_date) as d
                from leads group by 1) s
       where not exists (select 1 from campaigns c
                          where c.name = reach_legacy_campaign_name(s.src) and c.source_sheet = s.src) $q$;
    get diagnostics v_n = row_count;
    return jsonb_build_object('done', true, 'processed', v_n);

  elsif p_step = 'ledger' then
    -- Whole email groups per chunk, so duplicates collapse exactly: the
    -- earliest date wins, one legacy send per address.
    execute format($q$
      with emails as (
        select distinct l.mig_email as e
          from leads l left join migration_decisions d on d.lead_id = l.id
         where (l.status = 'Not Now' or d.decision = 'Ledger') and l.mig_email <> ''
         limit %s
      ), batch as (
        select l.id, l.mig_email as e, coalesce(l.last_contacted, l.date_added, current_date) as dt, c.id as cid
          from leads l
          left join migration_decisions d on d.lead_id = l.id
          join campaigns c on c.name = reach_legacy_campaign_name(coalesce(l.source_list, ''))
                          and c.source_sheet = coalesce(l.source_list, '')
         where (l.status = 'Not Now' or d.decision = 'Ledger') and l.mig_email in (select e from emails)
      ), cs as (
        insert into campaign_sends (campaign_id, email_norm, sent_at)
        select distinct on (cid, e) cid, e, dt from batch order by cid, e, dt
        on conflict (campaign_id, email_norm) do nothing
        returning 1
      ), led as (
        insert into sent_ledger (email_norm, email_domain, first_sent_at, last_sent_at, send_count, first_campaign_id, last_campaign_id)
        select distinct on (e) e, split_part(e, '@', 2), dt, dt, 1, cid, cid from batch order by e, dt
        on conflict (email_norm) do update set
          first_campaign_id = case when excluded.first_sent_at < sent_ledger.first_sent_at then excluded.first_campaign_id else sent_ledger.first_campaign_id end,
          first_sent_at     = least(sent_ledger.first_sent_at, excluded.first_sent_at)
        returning 1
      ), del as (
        delete from leads where id in (select id from batch) returning 1
      )
      select (select count(*) from del)::int + 0 * ((select count(*) from cs) + (select count(*) from led)) $q$, v_lim)
      into v_n;
    return jsonb_build_object('done', v_n = 0, 'processed', v_n);

  elsif p_step = 'archive_delete' then
    execute format($q$
      delete from leads where id in (
        select l.id from leads l left join migration_decisions d on d.lead_id = l.id
         where (l.status = 'Not Now' or d.decision = 'Ledger') and coalesce(l.mig_email, '') = ''
         limit %s) $q$, v_lim);
    get diagnostics v_n = row_count;
    return jsonb_build_object('done', v_n = 0, 'processed', v_n);

  elsif p_step = 'relationships' then
    execute format($q$
      with batch as (
        select l.*, d.decision, c.id as cid
          from leads l
          left join migration_decisions d on d.lead_id = l.id
          left join campaigns c on c.name = reach_legacy_campaign_name(coalesce(l.source_list, ''))
                               and c.source_sheet = coalesce(l.source_list, '')
         where l.status <> 'Not Now' and coalesce(d.decision, '') <> 'Ledger'
           and not exists (select 1 from relationships r where r.id = l.id)
           and (coalesce(l.company_name, '') <> '' or coalesce(l.contact_person, '') <> '' or coalesce(l.email, '') <> '')
         limit %s
      ), ins as (
        insert into relationships (id, company_name, company_name_clean, contact_person, email, status,
                                   source_campaign_id, replied_at, last_contacted, next_follow_up, created_at)
        select b.id, coalesce(b.company_name, ''), coalesce(b.company_name_clean, ''), coalesce(b.contact_person, ''),
               coalesce(b.email, ''),
               case b.status
                 when 'Won' then coalesce(b.decision, 'Active Client')
                 when 'Warm' then 'In Conversation'
                 when 'In Progress' then 'In Conversation'
                 when 'Dead' then coalesce(b.decision, 'Declined')
                 else 'In Conversation' end,
               case when coalesce(b.source_list, '') <> '' then b.cid end,
               coalesce(b.last_contacted, b.date_added, current_date),
               b.last_contacted, b.next_follow_up, b.created_at
          from batch b
        returning id, email_norm, status, source_campaign_id, replied_at
      ), notes as (
        insert into relationship_notes (id, relationship_id, note, created_at, auto)
        select n.id, n.lead_id, n.note, n.created_at, false from lead_notes n where n.lead_id in (select id from ins)
        on conflict (id) do nothing
        returning 1
      ), mig_note as (
        insert into relationship_notes (relationship_id, note, auto)
        select i.id, 'Migrated from the old leads table (' || b.status || ' to ' || i.status
                     || coalesce(', sheet ' || nullif(b.source_list, ''), '') || ')', true
          from ins i join batch b on b.id = i.id
        returning 1
      ), cs as (
        insert into campaign_sends (campaign_id, email_norm, sent_at)
        select i.source_campaign_id, i.email_norm, i.replied_at from ins i
         where i.email_norm <> '' and i.source_campaign_id is not null
        on conflict (campaign_id, email_norm) do nothing
        returning 1
      ), led as (
        insert into sent_ledger (email_norm, email_domain, first_sent_at, last_sent_at, send_count, first_campaign_id, last_campaign_id, replied)
        select distinct on (i.email_norm) i.email_norm, split_part(i.email_norm, '@', 2), i.replied_at, i.replied_at, 1,
               i.source_campaign_id, i.source_campaign_id, true
          from ins i where i.email_norm <> '' and i.source_campaign_id is not null
         order by i.email_norm, i.replied_at
        on conflict (email_norm) do update set replied = true
        returning 1
      ), rep as (
        insert into campaign_replies (campaign_id, email_norm, relationship_id)
        select i.source_campaign_id, i.email_norm, i.id from ins i
         where i.email_norm <> '' and i.source_campaign_id is not null
        on conflict (campaign_id, email_norm) do nothing
        returning 1
      )
      select (select count(*) from ins)::int
             + 0 * ((select count(*) from notes) + (select count(*) from mig_note) + (select count(*) from cs)
                    + (select count(*) from led) + (select count(*) from rep)) $q$, v_lim)
      into v_n;
    return jsonb_build_object('done', v_n = 0, 'processed', v_n);

  elsif p_step = 'counters' then
    update campaigns c set
      sent_count  = (select count(*) from campaign_sends s where s.campaign_id = c.id),
      reply_count = (select count(*) from campaign_replies r where r.campaign_id = c.id)
     where exists (select 1 from campaign_sends s where s.campaign_id = c.id)
        or exists (select 1 from campaign_replies r where r.campaign_id = c.id);
    get diagnostics v_n = row_count;
    return jsonb_build_object('done', true, 'processed', v_n);
  end if;

  raise exception 'Unknown migration step %', p_step;
end $$;

-- The rows that cannot enter an email ledger (Not Now / ghost rows with no
-- valid email) plus every note attached to any row leaving for the ledger.
-- The app downloads this as Legacy_Archive csv before those rows are removed.
create or replace function migration_archive_rows() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if to_regclass('public.leads') is null then return '[]'::jsonb; end if;
  execute $q$
    select coalesce(jsonb_agg(x order by x.sheet, x.company, x.contact, x.email, x.note_date), '[]'::jsonb) from (
      select coalesce(l.source_list, '') as sheet, coalesce(l.company_name, '') as company,
             coalesce(l.contact_person, '') as contact, coalesce(l.mig_email, '') as email, l.status,
             l.date_added, l.last_contacted,
             case when coalesce(l.mig_email, '') = '' then 'No valid email' else 'Note on a ledger row' end as reason,
             n.note, n.created_at as note_date
        from leads l
        left join migration_decisions d on d.lead_id = l.id
        left join lead_notes n on n.lead_id = l.id
       where (l.status = 'Not Now' or d.decision = 'Ledger')
         and (coalesce(l.mig_email, '') = '' or n.id is not null)
    ) x $q$ into r;
  return r;
end $$;

-- Final step, after you have confirmed the counts: the old tables are renamed
-- (not dropped) to *_retired_<date>, and their public policies removed.
create or replace function migration_retire() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_left int;
  v_copied int;
  v_suffix text := to_char(now(), 'YYYYMMDD');
begin
  if to_regclass('public.leads') is null then raise exception 'Nothing to retire'; end if;
  execute 'select count(*) from leads' into v_left;
  execute 'select count(*) from relationships r where exists (select 1 from leads l where l.id = r.id)' into v_copied;
  if v_left <> v_copied then
    raise exception 'Counts do not match: % rows left in leads, % copied to relationships', v_left, v_copied;
  end if;
  execute 'drop policy if exists "public access leads" on leads';
  execute 'drop policy if exists "public access lead_notes" on lead_notes';
  execute format('alter table leads rename to %I', 'leads_retired_' || v_suffix);
  execute format('alter table lead_notes rename to %I', 'lead_notes_retired_' || v_suffix);
  delete from migration_decisions;
  return jsonb_build_object('retired', true, 'rows', v_left,
                            'leads_table', 'leads_retired_' || v_suffix, 'notes_table', 'lead_notes_retired_' || v_suffix);
end $$;

-- Tell PostgREST about the new tables and functions straight away.
notify pgrst, 'reload schema';
