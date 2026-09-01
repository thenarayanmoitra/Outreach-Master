# Reach — Outreach Tracker

One self-contained HTML file. No build step, no framework beyond two CDN scripts (SheetJS for reading Excel/CSV, Supabase JS for the database). Drop it into a Netlify site folder and it deploys like any other page.

## What it does

Import lead lists from many spreadsheets over time into one central table, see your pipeline at a glance, and get warned before you contact a company or email you've already reached out to — even when the spelling doesn't match exactly.

Duplicate checks run on: exact email, exact cleaned company name (strips Pvt Ltd, Inc, LLC, Travel, Group, DMC, Association, Alliance, and similar boilerplate words, plus punctuation), a fuzzy similarity check on what's left of the company name, shared email domain, and matching contact-person name. The matching is deliberately generous — it's tuned to over-flag rather than risk missing a repeat, since the whole point is never re-emailing an existing client, a coworker at the same company, or someone who already said no. The same check runs live in the manual add-lead form, not just during import.

A row with no company name doesn't get blocked — as long as it has a contact name or an email, it imports fine and matches on whichever of those it has.

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL editor in that project and run everything in `schema.sql` (in this folder).
3. In your project's API settings, copy the **Project URL** and the **anon public** key.
4. Open `index.html` and near the top of the `<script>` block, set:
   ```js
   const SUPABASE_URL = 'https://your-project.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key';
   ```
5. Deploy: push this folder to a GitHub repo and connect it to Netlify (same pattern as your other tools), or drag the folder onto Netlify Drop for a quick test.

Until you set those two values, the app runs on a local-storage fallback so you can try it in one browser right away — nothing syncs across devices in that mode, and it says so in a banner at the top.

## Data model

- **leads** — one row per company/contact. `company_name_clean` and `email_domain` are computed automatically for matching.
- **lead_notes** — a timestamped timeline per lead, so history is never overwritten by a single note field.
- **campaigns** — one row per outreach batch: dataset/campaign name, date, number of mails, status, response/notes. Auto-logged every time you import a sheet, and hand-editable besides.

RLS is enabled with a permissive policy so the anon key can read/write — there's no login screen, matching your other single-user apps. Don't put anything in this table you wouldn't want visible to anyone who found the page URL.

## Using it

- **Import** — drag one or many `.xlsx`/`.csv` files. Map columns once per distinct header layout (company, contact, email, notes, status); the mapping is remembered in this browser for files with the same headers. The review screen shows every row as New or Possible Duplicate with the reason, the matched lead, and its most recent note, and lets you skip, add anyway, or merge into the existing record — per row or in bulk. Everything you import defaults to **Not Now** status unless the sheet has its own status column — nothing gets auto-marked Won or Dead on your behalf. Every import also drops a row onto the **Campaigns** sheet automatically (name, date, mail count).
- **Leads** — looks and behaves like a spreadsheet: row numbers, gridlines, click any cell and type. Each import lands on its own sheet tab at the bottom, the same way Google Sheets tabs work — **double-click a tab to rename it**, hover a tab for a small **×** to delete it. Deleting asks what to do with its leads: move them to Unlabeled and keep the data, or delete the sheet and its leads together — an empty sheet just deletes outright. An "All leads" tab sits first for when you need to see or search across everything at once — that's also where the duplicate memory always checks, regardless of which tab you're viewing. Hit **+** to start a new empty sheet by hand.
  - **Bulk edit**: tick the checkbox on any rows (or the header checkbox to select everything visible) to get a bar for setting status, moving to another sheet, or deleting — in bulk.
  - **Drag-fill**: click any cell (status, follow-up date, or any other field) and a small square appears at its corner — drag that down (or up) across rows and release to copy that value into all of them. This is the fast way to mark a run of rows Not Now, or set the same follow-up date across ten leads at once.
- **Add lead** — the same duplicate check runs live as you type a company name, contact name, or email. Only one of those three is required.
- **Kanban** — defaults to grouping everything into the Not Now column; drag a card to change its status. Filter to one sheet at a time with the dropdown, or view all sheets together.
- **Campaigns** — a separate spreadsheet for tracking outreach batches: which list, when, how many emails, status (Scheduled / In Progress / Completed / Paused), and a free-text response/notes column. Add rows by hand for anything not tied to an import.
- **Dashboard** — stays global across all sheets: total leads, funnel (contacted → responded → won), leads added per month, breakdown by status and by sheet, and what's due for follow-up this week.

Click the 🗒 on any lead row to open its full profile: edit every field, set **last contacted** (there's a one-click "Today" button) and the next follow-up date, and add to its notes timeline. Last contacted is what the Dashboard funnel's Contacted/Responded numbers are built from — a lead sits outside that funnel until you've logged a contact date for it, same as any CRM.

## Brand

Tokens are lifted straight from `Pratim_Brand Guidelines.docx` (Field Guide v1) — warm gold accent used only where text-safe, sage-tinted paper, forest ink, 4px radius everywhere, Space Grotesk for headings, Manrope for body/UI, Space Mono for micro-labels, Fraunces italic reserved for the "reach" wordmark. Same CSS variable pattern as the Task Board app, so it sits in the same visual family.
