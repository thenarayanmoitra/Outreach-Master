# Reach — never-mail memory

Reach does one job: it remembers who you must never cold-mail again, and cleans your sheets against that memory. Your lists, campaigns and contact details stay in Google Sheets.

One HTML file, no build step. Two CDN scripts (SheetJS for Excel/CSV, Supabase JS for the database). Drop it into a Netlify folder and it deploys like any other page.

## What Reach remembers (and nothing else)

| Memory | What's in it | How it gets there |
|---|---|---|
| **Clients** | Email, company, name, note. A client can also be just a company. | Memory → Add to memory |
| **Replied** | Anyone who already replied (yes, no or later). | Memory → Add to memory |
| **Do not contact** | People who asked you to stop. | Memory → Add to memory |
| **Bounced** | Every address that ever bounced. Blocked forever. | Remove bounces |
| **Mailed before** | Bare addresses you sent to, plus first/last date. No names. | "I sent this list" after a check |

## The two things you do

**1. Check a new list before sending.** Check a list → drop the .xlsx/.csv (or paste addresses). Every address gets one label:

- **Blocked** (can never be sent): Client · Replied · Do not contact · Bounced · Duplicate in this list · No valid email
- **Your call** (left out unless you tick it): Mailed before · At a client's company (same email domain as a client, or the same company name)
- **Ready**: Reach knows nothing about them

Download the clean list. It's your sheet with the same columns, in the same order and with the same values, minus the rows that shouldn't be mailed. Send it, then press **I sent this list** so Reach remembers those addresses. Undo is there if you press it by mistake, and pressing it twice changes nothing. **Left-out rows** downloads everything that was taken out, with the reason.

**2. Remove bounces after a send.** Remove bounces → paste the bounced addresses (bare addresses or whole bounce notifications; mailer-daemon and message ids are ignored) → optionally drop the list you sent from → see exactly what will happen → **Block & download clean list**. The bounced addresses are blocked forever; the list comes back without them (1,000 rows → 900). If a cell held two addresses and only one bounced, only that one is taken out of the cell. Addresses that bounced *before* and are still in the sheet are taken out too (you can switch that off). Nothing is saved until you press the button.

**Memory** shows the counts, lets you look up any address, add people, fix mistakes (edit, remove, unblock, forget, each with Undo), and download a full backup (one .xlsx with People, Bounced, Mailed).

## Safety rules the code follows

- Checking never writes anything. Only three buttons write: *I sent this list*, *Block … forever*, *Add to memory* (plus edits in Memory).
- If the memory check fails halfway (connection drop), every address shows **Not checked**, nothing is Ready, and download is locked until Retry succeeds.
- Every write is one database transaction and an upsert, so retries and double clicks can't create duplicates. A write that fails halfway can simply be repeated.
- Bounces are saved before the clean file is downloaded. If saving fails, you get no file.
- Email matching is exact after normalisation: spaces, capitals, `mailto:`, `<>`, quotes and invisible characters are cleaned. The page and the database use identical rules (tested against each other).
- Your sheet's values are copied untouched. Long numbers keep every digit, "00123" stays "00123", dates stay dates.

## Setup / upgrading from Reach v2

1. Supabase → **SQL Editor** → New query → paste all of **`reach.sql`** → Run.
   - It creates the `never_mail` table and copies your old relationships into it: Active/Past Client → Client, Do Not Contact → Do not contact, everyone else who replied → Replied. The old status and your latest note go into the note.
   - Your existing bounce list and sent ledger are used as they are.
   - It never drops or deletes anything. The old tables (relationships, campaigns, …) stay as a backup.
   - Safe to run again: it copies nothing twice.
2. Deploy the new `index.html`. (Deploy it before step 1 and it shows a "run reach.sql" screen instead of breaking.)

**Optional, recommended:** lock it to your login. Create your user in Supabase → Authentication → Users, set `const REQUIRE_LOGIN = true;` in `index.html`, deploy, then run `security-lockdown.sql`.

## Brand

Tokens from `Pratim_Brand Guidelines.docx` (Field Guide v1): sage paper, forest ink, warm gold accent, 4px radius, Space Grotesk / Manrope / Space Mono, Fraunces italic wordmark.
