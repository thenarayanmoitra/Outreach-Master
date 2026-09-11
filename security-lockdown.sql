-- =============================================================================
-- Reach — optional lockdown (spec section 12)
--
-- Relationships now hold client names and statuses, which is more sensitive
-- than a raw list. This switches every Reach table and function from "anyone
-- with the anon key" to "signed-in users only".
--
-- Order matters, or you lock yourself out:
--   1. Supabase dashboard > Authentication > Users > Add user: create your
--      own login (email + password). Under Authentication > Providers, you
--      can turn off "Allow new users to sign up" so nobody else can.
--   2. In index.html set  const REQUIRE_LOGIN = true;  and deploy it.
--   3. Run this file in the SQL editor.
-- To undo: re-run schema.sql (it restores the open policies), then run
--   grant execute on all functions in schema public to anon;
-- and set REQUIRE_LOGIN back to false.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['relationships','relationship_notes','sent_ledger','campaign_sends',
                           'campaigns','bounce_suppression','campaign_replies','migration_decisions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on %I', 'public access ' || t, t);
      execute format('drop policy if exists %I on %I', 'signed in access ' || t, t);
      execute format('create policy %I on %I for all to authenticated using (true) with check (true)',
                     'signed in access ' || t, t);
    end if;
  end loop;
  -- The old tables too, if the migration hasn't been run yet.
  foreach t in array array['leads','lead_notes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on %I', 'public access ' || t, t);
      execute format('drop policy if exists %I on %I', 'signed in access ' || t, t);
      execute format('create policy %I on %I for all to authenticated using (true) with check (true)',
                     'signed in access ' || t, t);
    end if;
  end loop;
end $$;

-- Functions: nobody but a signed-in user may call them.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('reach_norm_email','check_emails','check_domains','mark_sent','undo_mark_sent',
                         'purge_preview','purge_bounces','suppression_list','suppression_remove',
                         'create_referral','log_reply','delete_relationship','delete_campaign',
                         'campaign_sends_page','ledger_lookup','export_ledger_page','dashboard_stats',
                         'migration_status','migration_review_rows','migration_save_decisions',
                         'migration_snapshot','migration_step','migration_archive_rows','migration_retire',
                         'reach_recompute_ledger','reach_recount_campaign','reach_legacy_campaign_name')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
