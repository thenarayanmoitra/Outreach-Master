-- Reach — Outreach Tracker
-- Run this once in your Supabase project's SQL editor (Database > SQL Editor > New query).

create extension if not exists pgcrypto;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  company_name_clean text not null default '',
  contact_person text default '',
  email text default '',
  email_domain text default '',
  status text not null default 'Not Now' check (status in ('Won','In Progress','Warm','Not Now','Dead')),
  source_list text default '',
  date_added date not null default current_date,
  last_contacted date,
  next_follow_up date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_company_clean_idx on leads (company_name_clean);
create index if not exists leads_email_idx on leads (lower(email));
create index if not exists leads_domain_idx on leads (email_domain);
create index if not exists leads_status_idx on leads (status);

create table if not exists lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists lead_notes_lead_idx on lead_notes (lead_id);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null default current_date,
  mail_count int not null default 0,
  status text not null default 'Completed' check (status in ('Scheduled','In Progress','Completed','Paused')),
  response text default '',
  created_at timestamptz not null default now()
);

create index if not exists campaigns_date_idx on campaigns (date);

-- This is a single-user tool with no login screen, same pattern as your other
-- self-contained apps. The anon key ships in the page source (that's normal for
-- Supabase's client-side model), so these policies allow that key to read and
-- write freely. Don't put anything in here you wouldn't want visible to anyone
-- who found the page URL and inspected the network tab.
alter table leads enable row level security;
alter table lead_notes enable row level security;
alter table campaigns enable row level security;

create policy "public access leads" on leads for all using (true) with check (true);
create policy "public access lead_notes" on lead_notes for all using (true) with check (true);
create policy "public access campaigns" on campaigns for all using (true) with check (true);
