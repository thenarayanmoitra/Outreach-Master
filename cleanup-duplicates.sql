-- Reach — one-off cleanup for the duplicated Start/08 import (2026-09-06)
-- Run in Supabase: Database > SQL Editor > New query. Run each step separately.
--
-- Background: the Commit import button could be clicked more than once, and
-- each click inserted the whole list again. Every sampled Start/08 email
-- currently exists 7 times. This keeps the earliest copy of each row and
-- deletes the rest. Nothing unique is removed: rows are grouped by sheet +
-- email + company + contact, so a lead that legitimately appears in two
-- different sheets is untouched.


-- STEP 1 — look before you touch anything.
select count(*)                                                   as total_rows,
       count(*) filter (where source_list = 'Start/08')           as start08_rows,
       count(distinct (lower(coalesce(email,'')),
                       lower(coalesce(company_name,'')),
                       lower(coalesce(contact_person,''))))
         filter (where source_list = 'Start/08')                  as start08_unique
from leads;


-- STEP 2 (optional) — snapshot before deleting. Skip if you are near the
-- 500 MB free-tier storage cap, since this doubles the table for a while.
-- create table leads_backup_20260906 as select * from leads;


-- STEP 3 — delete the redundant copies, in batches of 50,000 so the SQL
-- editor doesn't time out. Re-run this same statement until it reports
-- 0 rows affected.
with ranked as (
  select id,
         row_number() over (
           partition by source_list,
                        lower(coalesce(email,'')),
                        lower(coalesce(company_name,'')),
                        lower(coalesce(contact_person,''))
           order by created_at, id
         ) as rn
  from leads
  where source_list = 'Start/08'
)
delete from leads
where id in (select id from ranked where rn > 1 limit 50000);


-- STEP 4 — confirm. start08_rows and start08_unique should now match.
select count(*)                                         as total_rows,
       count(*) filter (where source_list = 'Start/08') as start08_rows
from leads;


-- STEP 5 (only if you want the same sweep across every sheet, not just
-- Start/08) — same statement without the source_list filter. Read STEP 1's
-- numbers first; this is a wider net.
-- with ranked as (
--   select id,
--          row_number() over (
--            partition by source_list,
--                         lower(coalesce(email,'')),
--                         lower(coalesce(company_name,'')),
--                         lower(coalesce(contact_person,''))
--            order by created_at, id
--          ) as rn
--   from leads
-- )
-- delete from leads where id in (select id from ranked where rn > 1 limit 50000);
