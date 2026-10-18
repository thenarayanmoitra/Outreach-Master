# Reach — outreach memory

Reach remembers who you must never cold-mail again, and cleans every list you are about to send against that memory. It replaces the Google Sheet tracker and the old Supabase-only app.

- **Local-first.** Everything lives in this browser's IndexedDB. Nothing is sent anywhere unless you turn on cloud backup.
- **Private.** Optional vault passphrase encrypts everything at rest (AES-256-GCM, PBKDF2-SHA256 with 310k rounds). Screened lists are never stored; only the bare addresses you confirm as sent are kept.
- **Safe.** Autosave with a visible save state, undo/redo for every action, a 30-day trash, daily snapshots, one-click backups, and an append-only encrypted cloud mirror if you want one.
- **Fast.** Plain HTML + JS, no build step. 50,000-row sheets screen in well under a second; the sheets are virtualised.

## Run it

```bash
node serve.js
```

Open http://127.0.0.1:4477. (Or add the `reach` entry already in `.claude/launch.json` to start it from the Claude app.) The folder also deploys as-is to Netlify or any static host; it works in any modern browser. Keep using one browser profile: that is where the memory lives.

First launch loads the 32 people from *My Leadsheet / Job Enquiry – Response Tracker* (`data/seed.js`), with statuses taken from the colour coding:

| Sheet colour | Reach status | Screening default |
|---|---|---|
| Green — got hired | **Client** | Blocked, and anyone at the same domain is blocked |
| Yellow — showed interest | **Warm** | Blocked |
| Blue — in the pipeline | **In pipeline** | Blocked; same domain is "your call" |
| Red — closed for now | **Not now** | Blocked until its *revisit on* date passes, then "your call" |
| Orange — worked together before | **Past client** | Blocked; same domain is "your call" |
| — | **Do not contact** | Blocked, always |

Everything in the seed is editable in Sheets.

## The loop

1. **Screen a list** — drop an .xlsx/.csv, or paste cells straight from Google Sheets. Reach detects the email / company / name columns and gives every row a verdict:
   - **Blocked** — exact address in memory, hard bounce, duplicate in the list, no valid email.
   - **Your call** — same company domain or name as someone you know, same full contact name, mailed before, soft bounce. Left out unless you tick them.
   - **Ready** — nothing in memory.
   The summary tells you plainly: *"Pratim, you already know 7 of these 14 …"*. Download the clean list (same columns, same order), the left-out rows with reasons, or the whole sheet annotated. Copy the ready addresses to the clipboard.
2. **I sent this list** — remembers the bare addresses and the date under a campaign name, so the next list is checked against them too. Undo is one click.
3. **Bounces** — paste the bounce notifications (whole emails are fine) or upload the export from your sending tool. Hard bounces are blocked forever; soft ones are flagged. Attach them to the campaign for a bounce rate. Optionally drop the list you sent and get it back without the bounced rows.
4. **Log a reply** — paste the `From:` line. They become Warm / In pipeline / Client / Not now / Do not contact and are never cold-mailed again. Replies count against the campaign.

## Sheets

People · Bounces · Mailed · Campaigns · Trash · Activity. Every cell is editable in place (double-click or just type; Enter/Tab/arrows move around, Esc cancels). Select rows for bulk status, tags, revisit dates, merge, export or delete. Open any record for the full timeline, related records at the same company, and quick actions.

Import your other sheets with **Import file**: columns are detected, a status is suggested per row from the notes, and rows that match people already in memory are merged, not duplicated.

## Settings

- **Rules** — what each status does on exact match / same domain / same company; bounce handling; mailed-before cooldown; role and free mailboxes.
- **Lists** — free-mail domains, role mailboxes, company suffixes.
- **Privacy** — vault on/off, change passphrase, auto-lock after idle, where data lives.
- **Backups** — download/restore a `.json` backup (optionally encrypted), snapshots on this device, cloud backup, the one-time import from the old Reach, delete everything.

## Cloud backup (optional, Supabase)

1. Resume the Supabase project (free projects pause after a week idle).
2. SQL Editor → paste `supabase/reach_backups.sql` → Run. Creates an append-only `reach_backups` table.
3. Settings → Backups → turn on cloud backup. The project URL and publishable key from the old app are pre-filled; set a backup passphrase.

Every backup is encrypted on your device before upload. Supabase only ever stores ciphertext, and the public key can insert and read rows but never update or delete them. Restore on another device with the same passphrase. The old `never_mail`, `sent_ledger` and `bounce_suppression` tables are untouched; the next section brings their contents here.

## Bring the old Reach memory across (one time)

The previous app kept its memory in three Supabase tables: `never_mail` (clients, people who replied, people who asked you to stop), `bounce_suppression` (every address that bounced, with the date) and `sent_ledger` (bare addresses you mailed, with first/last dates and counts). Reach v4 starts from the Response Tracker seed only, so this import adds the rest without duplicating anyone already here.

1. Resume the Supabase project (dashboard → Restore). Nothing else is needed if the old tables were never locked down.
2. Only if "Read the old tables" fails with a permission error: SQL Editor → paste `supabase/old_tables_read.sql` → Run. It gives the publishable key read-only access to the three old tables and nothing else; the file ends with the statements that take it away again.
3. Settings → Backups → **Import from the old Reach (Supabase)** → *Read the old tables*. The project URL and publishable key are pre-filled from the cloud backup settings. Reach reads each table through the REST API in pages of 1,000 rows and shows a preview before anything is written: rows per table, how many people are new vs. merge into records already in memory, the status breakdown, and the first 300 people.
4. Press *Import*. A snapshot is taken first (Settings → Backups → Snapshots, labelled *before old Reach import*), then everything is written in one transaction. **Undo** in the toast, or `⌘Z`, takes the whole import back.

What becomes what:

| Old table / value | In Reach |
|---|---|
| `never_mail` with reason **Client** | Person with status **Client** |
| `never_mail` with reason **Replied** | Person with status **Warm**, *last reply* = the old *added_at* date |
| `never_mail` with reason **Do not contact** | Person with status **Do not contact** |
| `never_mail` row with an email already in memory | Merged into that person: email, note and status updated, nothing duplicated |
| `never_mail` row with no email (client known by company only) | Company-only person; merged if the company is already here |
| `bounce_suppression` | Hard bounce, dated *bounced_at*, source "old reach" |
| `sent_ledger` | Mailed address with its *first_sent_at*, *last_sent_at* and *send_count*; an address already in Mailed has its dates widened and keeps the higher count |

Each imported person carries the source *Old Reach (Supabase)* and a timeline entry naming the old reason and date. Running the import twice is safe: the preview shows everything as "already here" and nothing is duplicated. `node check/old-reach-check.js` exercises the mapping and the paged reader against sample rows.

### Prefer CSV?

If you would rather not open the API, export each table from Supabase and drop the file on the matching Reach screen. In the Supabase dashboard: **Table Editor → pick the table → the ⋯ menu on the table (or the Export button above the grid) → Download as CSV**. Then:

| CSV | Drop it on | Notes |
|---|---|---|
| `never_mail.csv` | **Sheets → People → Import file** | Email, company and contact columns are detected. Set the *Status column* dropdown to `reason` so Client → Client; then use *Set all to* or the per-row dropdowns for the Replied rows (→ Warm) and Do not contact rows (→ Do not contact). Rows already in memory show "merges into …" and are not duplicated. Tip: filter the table by reason in Supabase and export three CSVs, then import each with the right status. |
| `bounce_suppression.csv` | **Bounces** (drop the file in *Upload the export*) | All rows come in as hard bounces. One bounce date per import; pick it in the date field before pressing *Block*. |
| `sent_ledger.csv` | **Sheets → Mailed → Mark addresses as mailed** | Open the CSV, copy the `email_norm` column and paste it. One *Sent on* date per paste; the Supabase import keeps the real first/last dates and counts, the paste does not. |

## Files

```
index.html            page shell
css/app.css           design system (light + dark)
js/util.js            DOM, dates, files (CSV/XLSX read and write)
js/match.js           email/company/domain/name matching, screening rules, bounce parsing
js/store.js           IndexedDB store, vault encryption, undo, trash, snapshots
js/cloud.js           Supabase REST backup
js/migrate.js         one-time import from the old Reach tables (Supabase REST, mapping, preview, apply)
js/ui.js              toasts, modals, drawer, menus, virtual editable grid
js/app.js             shell, router, search, shortcuts, lock screen
js/people-ui.js       record drawer, add/import people, log a reply
js/view-*.js          dashboard, screen, bounces, sheets, settings
data/seed.js          starter memory from the Response Tracker
vendor/xlsx.full.min.js   SheetJS, bundled so nothing loads from a CDN
supabase/reach_backups.sql     cloud backup table (append-only)
supabase/old_tables_read.sql   read-only access to the old tables, only if they were locked down
check/old-reach-check.js       node check for the old-Reach import mapping and paging
serve.js              zero-dependency local server
```

Keyboard: `⌘K` lookup · `⌘Z` / `⌘⇧Z` undo/redo · `G` then `D/S/B/P/T` to jump between pages · `?` for the full list.
