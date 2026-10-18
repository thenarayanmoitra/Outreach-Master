-- =============================================================================
-- Reach v4 — read-only access to the OLD Reach tables, for the one-time import
-- (Settings → Backups → Import from the old Reach).
--
-- Only needed if the old project was locked down (its security-lockdown.sql),
-- so the publishable (anon) key can no longer read never_mail,
-- bounce_suppression and sent_ledger. If "Read the old tables" works without
-- it, you do not need this file.
--
-- Run it once in Supabase: Database → SQL Editor → New query → paste → Run.
-- Safe to re-run. It adds a SELECT-only policy for anon on the three tables
-- and nothing else: no insert, update or delete, and no other table. Tables
-- that do not exist are skipped. Signed-in access is left exactly as it was.
--
-- After the import you can take the access away again: see the bottom.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['never_mail', 'bounce_suppression', 'sent_ledger'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'Reach: skipping %, table not found', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon', t);
    execute format('drop policy if exists %I on public.%I', 'reach v4 read ' || t, t);
    execute format('create policy %I on public.%I for select to anon using (true)', 'reach v4 read ' || t, t);
  end loop;
end $$;

-- Tell the API about the change straight away.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Afterwards (optional): remove the read access again. Uncomment and run.
-- ---------------------------------------------------------------------------
-- drop policy if exists "reach v4 read never_mail"         on public.never_mail;
-- drop policy if exists "reach v4 read bounce_suppression" on public.bounce_suppression;
-- drop policy if exists "reach v4 read sent_ledger"        on public.sent_ledger;
-- notify pgrst, 'reload schema';
