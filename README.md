# Reach — Outreach Memory

One self-contained HTML file. No build step, no framework beyond two CDN scripts (SheetJS for Excel/CSV, Supabase JS for the database). Drop it into a Netlify site folder and it deploys like any other page.

Version 2 follows the **Reach Restructure Logic Spec (v1, 11 Sep 2026)**: data is split by value. People who replied are few and important and live in the browser with full fuzzy matching. People who never replied are many and are only remembered by exact email, on the server, and are never loaded in bulk. Raw lead lists live in Google Sheets — Reach is the memory, the checker, the clean exporter and the dashboard.

## Upgrading from v1 (do these in order)

1. **If you never ran `cleanup-duplicates.sql`, run it first.** The migration collapses duplicate *Not Now* rows by email automatically, but seven copies of a Won or Warm lead would become seven relationships.
2. **Run `schema.sql`** in Supabase → SQL Editor → New query. It creates the new tables and functions alongside the old ones and never touches `leads` / `lead_notes`. Safe to re-run.
3. **Deploy the new `index.html`.** (If you deploy it before step 2, the app shows a "run schema.sql" screen instead of breaking.)
4. Open the app → **Settings → Migrate from the old leads table** (a banner links there too) and follow the six steps:
   - **Snapshot** — copies `leads` and `lead_notes` to timestamped tables on the server.
   - **Prepare** — normalises every old email.
   - **Review Won & Dead** — Won → Active Client or Past Client; Dead → Declined, Do Not Contact, or *Ghost → ledger*. Warm and In Progress become In Conversation. Old auto-logged campaign rows that a Legacy campaign replaces can be deleted here.
   - **Archive** — downloads `Reach_LegacyArchive_All_<date>.csv`: rows with no valid email plus every note on a row leaving for the ledger.
   - **Move data** — one `Legacy, <sheet>` campaign per old sheet with real campaign sends; Not Now rows (and ghosts) → sent ledger, earliest date kept, one legacy send per address; everyone else → relationships with the same ids and their notes. Runs in small resumable chunks, so a dropped connection just means pressing Run again.
   - **Confirm & retire** — once rows left in `leads` match rows copied, the old tables are *renamed* to `*_retired_<date>` (not dropped) and their public access removed.
5. Optional but recommended, **lock it down** (spec 12): create your login in Supabase → Authentication → Users, set `const REQUIRE_LOGIN = true;` near the top of the script in `index.html`, deploy, then run `security-lockdown.sql`.

## Data model

| Table | What it holds | Loaded into the browser? |
|---|---|---|
| `relationships` | Anyone who sent a real human reply. Six statuses: Active Client, Past Client, In Conversation, Declined (with optional `revisit_after`), Redirected, Do Not Contact. Never deleted by any automated action. | Yes, fully |
| `relationship_notes` | Timeline per relationship. Every status change writes an automatic note (a database trigger, whichever screen made the change). | Yes, fully |
| `sent_ledger` | One ~100-byte row per address ever mailed: dates, send count, first/last campaign, replied. No names, no companies. | Never in bulk |
| `campaign_sends` | Which address was in which campaign. Unique per (campaign, email). | One page at a time, only when a campaign is opened |
| `campaigns` | Each batch, with stored `sent_count`, `bounce_count`, `reply_count`, `source_sheet`. | Yes (the list, without sends) |
| `bounce_suppression` | Every address ever removed as bounced, so it can never come back as New. | Never in bulk |
| `campaign_replies` | Helper: one row per person per campaign that replied, so `reply_count` can never be counted twice. | No |

All writes that matter run as single-transaction server functions (`mark_sent`, `undo_mark_sent`, `purge_bounces`, `log_reply`, `delete_campaign`, …), and every one is an upsert or insert-on-conflict with counters recomputed from real rows — a retry or a double click can never create duplicates. That is what permanently replaces `cleanup-duplicates.sql`, which only matters for the old `leads` table.

Email normalisation is one function used everywhere (`normEmail()` in the page, `reach_norm_email()` in SQL — they match): trims whitespace, non-breaking spaces and zero-width characters, strips `mailto:`, angle brackets, quotes, commas and semicolons, lowercases, and validates the shape. No Gmail dot or plus-alias rewriting — matching is exact.

## Using it

- **Check a list** (<kbd>C</kbd>) — drop one or more `.xlsx`/`.csv` files or paste addresses. Map columns once per header layout (remembered), and pick any extra columns to carry through. Reach normalises, splits cells holding several addresses, collapses duplicates inside the upload (keeps the first, tells you), checks relationships in the browser, then the ledger and suppression list on the server 500 at a time. Every row gets exactly one label — **Invalid, Blocked, Warning, Previously mailed, New** — with the reason, the matched record, its status and latest note. Blocked and Invalid can never be included; warnings are yours to include. **Checking never writes anything.**
- **Export clean list** — Company, Contact Name, Email, your carried-through columns, then Reach Label / Times Mailed / Last Mailed (a toggle removes those three for a file that goes straight into your sending tool).
- **Mark as sent** — after you send it, record it against an existing or new campaign (name, date, source sheet). Also available standalone from Campaigns with an uploaded or pasted final list. **Undo last Mark as Sent** reverses exactly the rows that action inserted and restores the ledger values, for the rest of the session.
- **Relationships** — status chips replace the old sheet tabs; table or board; inline status and follow-up; bulk status and follow-up (never bulk delete). **Log reply** (<kbd>R</kbd>) checks the ledger and pre-fills the source campaign, opens the existing record if the address is already a relationship, handles "replied from a different address" (the relationship keeps the new address, the campaign gets the credit through the mailed one), asks for a revisit date on Declined, and on Redirected adds the referred person as a linked In Conversation record. **Bulk log replies** takes a paste box and an editable grid.
- **Campaigns** — counters, delivered-based reply and bounce rates, paged sends, **Remove bounced emails** (paste anything; four-group preview; one-click backup csv; type the count to confirm), **Export delivered list**, delete with the choice to keep (default) or remove the ledger history.
- **Ledger** — look up one exact address to see every campaign it was in, replies and bounces. **Full ledger backup** pages through the server with progress.
- **Settings** — domain warning (off by default), the bounce suppression list with search and remove, a global bounce purge across all campaigns, backups, migration, security.
- **Dashboard** — unique addresses contacted, sent this month vs last, overall reply rate, sends by month, relationships by status, per-campaign table, In Conversation → Active Client conversion, due this week (follow-ups and revisit dates), warm leads going cold (21+ days quiet). One `dashboard_stats()` call; nothing loads ledger rows.

Every export: CSV with a UTF-8 BOM (or XLSX), fixed columns with headers, normalised emails, no blank rows, no duplicate emails, no internal ids, sorted by company then contact then email, ISO dates, named `Reach_<Type>_<Scope>_<YYYYMMDD>`, and never a suppressed address (in the relationships export a bounced contact keeps their row with the dead address blanked and Email Bounced = Yes).

Without Supabase settings the app runs in **local mode**: relationships and campaigns work in this browser, and anything ledger-shaped says clearly that it needs the database connection.

If relationships ever pass roughly 5,000 rows, move the fuzzy company match to the server with `pg_trgm` (spec 9). Not needed now.

## Brand

Tokens are lifted straight from `Pratim_Brand Guidelines.docx` (Field Guide v1) — warm gold accent used only where text-safe, sage-tinted paper, forest ink, 4px radius, Space Grotesk for headings, Manrope for body/UI, Space Mono for micro-labels, Fraunces italic for the "reach" wordmark. The six relationship status colours are a colour-blind-checked categorical set; every status also carries its name, never colour alone.
