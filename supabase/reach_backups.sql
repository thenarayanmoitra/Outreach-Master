-- =============================================================================
-- Reach — optional cloud backup table
--
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
--
-- Reach keeps everything on your device. When you turn on cloud backup in
-- Settings, it encrypts the whole memory with your backup passphrase on your
-- device and appends ONE row here. Supabase only ever stores ciphertext.
--
-- The policies below let the public ("publishable"/anon) key INSERT and
-- SELECT rows, never UPDATE or DELETE them. So someone who finds the key in
-- the page source can add junk rows at worst; they can't read your data
-- (it's encrypted), and they can't change or remove a real backup.
-- Housekeeping (deleting old rows) is done here in the SQL editor, by you.
-- =============================================================================

create table if not exists reach_backups (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  device      text not null default '',
  label       text not null default '',
  bytes       integer not null default 0,
  people      integer not null default 0,
  bounces     integer not null default 0,
  ledger      integer not null default 0,
  payload     jsonb not null              -- { v, kdf, iterations, salt, iv, ct } — all base64, AES-256-GCM
);
create index if not exists reach_backups_created_idx on reach_backups (created_at desc);

alter table reach_backups enable row level security;

drop policy if exists "reach backups insert" on reach_backups;
create policy "reach backups insert" on reach_backups for insert to anon, authenticated with check (true);

drop policy if exists "reach backups read" on reach_backups;
create policy "reach backups read" on reach_backups for select to anon, authenticated using (true);

-- No update / delete policies on purpose: rows are append-only for the app key.

-- Keep the table small: run this now and then to drop everything but the 30 newest backups.
-- delete from reach_backups where id not in (select id from reach_backups order by created_at desc limit 30);

notify pgrst, 'reload schema';
