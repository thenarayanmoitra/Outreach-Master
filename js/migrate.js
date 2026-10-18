/* =============================================================================
   Reach — one-time import from the old Reach (Supabase)
   Reads the old project's never_mail, bounce_suppression and sent_ledger
   tables straight from its REST API and folds them into this device's memory
   through Store.upsertPerson / Store.addBounces / Store.rememberSent, inside
   one transaction so the whole import is a single undo. Nothing is written to
   Supabase. The mapping and planning functions are pure (no DOM, no Store), so
   check/old-reach-check.js can run them in Node.
   ============================================================================= */
'use strict';

const OLD_REACH_PAGE = 1000;
const OLD_REACH_SOURCE = 'Old Reach (Supabase)';
/* never_mail.reason → Reach status. The old table only ever allowed these three. */
const OLD_REACH_REASONS = { 'client': 'client', 'replied': 'warm', 'do not contact': 'dnc' };
/* Table → what we read, how we page it (stable order by primary key). */
const OLD_REACH_TABLES = {
  never_mail:         { select: 'id,email_norm,email_domain,reason,company_name,contact_person,note,added_at', order: 'id.asc' },
  bounce_suppression: { select: 'email_norm,bounced_at', order: 'email_norm.asc' },
  sent_ledger:        { select: 'email_norm,email_domain,first_sent_at,last_sent_at,send_count', order: 'email_norm.asc' },
};

const OldReach = {
  /* ---------- mapping (pure) ---------- */
  reasonToStatus(reason) {
    const k = String(reason || '').trim().toLowerCase();
    return OLD_REACH_REASONS[k] || null;
  },
  /* never_mail row → Store.upsertPerson input, or null when the row has nothing to go on. */
  mapPerson(row) {
    const r = row || {};
    const email = normEmail(r.email_norm).email;
    const company = String(r.company_name || '').trim(), name = String(r.contact_person || '').trim();
    if (!email && !company) return null;
    const status = this.reasonToStatus(r.reason) || 'dnc';
    const added = toISODate(r.added_at);
    const reason = String(r.reason || '').trim() || 'unknown reason';
    return {
      emails: email ? [email] : [], company, name,
      status, note: String(r.note || '').trim(),
      domain: email ? '' : String(r.email_domain || '').trim(),
      last_reply: status === 'warm' && added ? added : '',
      first_contact: added || '',
      source: OLD_REACH_SOURCE, historyType: 'import',
      historyNote: `Imported from the old Reach (never_mail: ${reason}${added ? `, added ${fmtDate(added)}` : ''})`,
      unknownReason: !this.reasonToStatus(r.reason),
    };
  },
  /* bounce_suppression row → Store.addBounces item plus the date it bounced. */
  mapBounce(row) {
    const r = row || {};
    const email = normEmail(r.email_norm).email;
    if (!email) return null;
    return { email, type: 'hard', reason: 'Bounced in the old Reach', date: toISODate(r.bounced_at) || todayISO() };
  },
  /* sent_ledger row → bare address with its first/last dates and send count. */
  mapLedger(row) {
    const r = row || {};
    const email = normEmail(r.email_norm).email;
    if (!email) return null;
    let first = toISODate(r.first_sent_at), last = toISODate(r.last_sent_at);
    if (!first && !last) first = last = todayISO();
    if (!first) first = last; if (!last) last = first;
    if (last < first) { const t = first; first = last; last = t; }
    return { email, first, last, count: Math.max(1, Number(r.send_count) || 1) };
  },

  /* ---------- planning (pure, given a lookup into what is already here) ----------
     data:   { never_mail: rows[], bounce_suppression: rows[], sent_ledger: rows[] }
     lookup: { person(emails, company) → existing person | null, bounce(email) → bool, ledger(email) → bool }
     Mirrors Store.upsertPerson's matching (email first, company only when there is no email) and
     also counts rows that fold into an earlier row of the same import, so the preview matches the result. */
  plan(data, lookup) {
    const d = data || {}, lk = Object.assign({ person: () => null, bounce: () => false, ledger: () => false }, lookup || {});
    const people = { total: (d.never_mail || []).length, skipped: 0, add: 0, merge: 0, unknownReason: 0, byStatus: {}, rows: [] };
    const seenEmail = new Set(), seenCompany = new Set();
    for (const row of d.never_mail || []) {
      const m = this.mapPerson(row);
      if (!m) { people.skipped++; continue; }
      if (m.unknownReason) people.unknownReason++;
      const ck = m.company ? cleanCompany(m.company) : '';
      const existing = lk.person(m.emails, m.company) || null;
      const within = m.emails.some(e => seenEmail.has(e)) || (!m.emails.length && ck.length >= 3 && seenCompany.has(ck));
      const merges = !!existing || within;
      merges ? people.merge++ : people.add++;
      people.byStatus[m.status] = (people.byStatus[m.status] || 0) + 1;
      for (const e of m.emails) seenEmail.add(e);
      if (ck.length >= 3) seenCompany.add(ck);
      people.rows.push({ input: m, existing, within });
    }
    const bounces = { total: (d.bounce_suppression || []).length, skipped: 0, add: 0, update: 0, rows: [] };
    const seenB = new Set();
    for (const row of d.bounce_suppression || []) {
      const m = this.mapBounce(row);
      if (!m) { bounces.skipped++; continue; }
      (lk.bounce(m.email) || seenB.has(m.email)) ? bounces.update++ : bounces.add++;
      seenB.add(m.email); bounces.rows.push(m);
    }
    const ledger = { total: (d.sent_ledger || []).length, skipped: 0, add: 0, update: 0, rows: [] };
    const seenL = new Set();
    for (const row of d.sent_ledger || []) {
      const m = this.mapLedger(row);
      if (!m) { ledger.skipped++; continue; }
      (lk.ledger(m.email) || seenL.has(m.email)) ? ledger.update++ : ledger.add++;
      seenL.add(m.email); ledger.rows.push(m);
    }
    const writes = people.rows.length + bounces.rows.length + ledger.rows.length;
    return { people, bounces, ledger, writes };
  },
  /* One line per table for the preview and the activity log. */
  summary(plan) {
    const p = plan.people, b = plan.bounces, l = plan.ledger;
    const st = Object.entries(p.byStatus).sort((x, y) => (STATUSES[x[0]]?.order ?? 9) - (STATUSES[y[0]]?.order ?? 9)).map(([k, n]) => `${fmtN(n)} ${STATUSES[k]?.label || k}`).join(', ');
    return [
      `${fmtN(p.rows.length)} people (${st || 'none'}): ${fmtN(p.add)} new, ${fmtN(p.merge)} merge into records already here${p.skipped ? `, ${fmtN(p.skipped)} skipped` : ''}`,
      `${fmtN(b.rows.length)} bounced addresses: ${fmtN(b.add)} new, ${fmtN(b.update)} already known${b.skipped ? `, ${fmtN(b.skipped)} skipped` : ''}`,
      `${fmtN(l.rows.length)} mailed addresses: ${fmtN(l.add)} new, ${fmtN(l.update)} already known${l.skipped ? `, ${fmtN(l.skipped)} skipped` : ''}`,
    ];
  },

  /* ---------- Supabase REST (browser) ---------- */
  headers(key) { return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' }; },
  endpoint(url, table, query) { return `${String(url).replace(/\/+$/, '')}/rest/v1/${table}?${query}`; },
  checkConfig({ url, key } = {}) {
    if (!/^https?:\/\/\S+$/.test(url || '') || (key || '').length < 20) throw new Error('Enter the old project URL and its publishable (anon) key first.');
  },
  /* Reads a whole table in pages of 1000 rows. onPage(rowsSoFar) after every page. */
  async fetchTable({ url, key }, table, onPage) {
    const spec = OLD_REACH_TABLES[table]; if (!spec) throw new Error(`Unknown old table: ${table}`);
    const rows = []; let offset = 0;
    for (;;) {
      const q = `select=${spec.select}&order=${spec.order}&limit=${OLD_REACH_PAGE}&offset=${offset}`;
      let r;
      try { r = await fetch(this.endpoint(url, table, q), { headers: this.headers(key) }); }
      catch (e) { throw new Error(`Could not reach ${url}. Is the Supabase project paused? Open the dashboard and resume it, then try again.`); }
      if (!r.ok) throw new Error(await this.errorText(r, table));
      const page = await r.json();
      if (!Array.isArray(page)) throw new Error(`Unexpected reply from ${table}.`);
      rows.push(...page); offset += page.length;
      if (onPage) onPage(rows.length);
      if (page.length < OLD_REACH_PAGE) break;
    }
    return rows;
  },
  async fetchAll(cfg, onProgress) {
    this.checkConfig(cfg);
    const data = {};
    for (const t of Object.keys(OLD_REACH_TABLES)) {
      if (onProgress) onProgress(t, 0);
      data[t] = await this.fetchTable(cfg, t, n => onProgress && onProgress(t, n));
    }
    return data;
  },
  async errorText(r, table) {
    let msg = `${r.status} ${r.statusText}`.trim();
    try { const j = await r.json(); if (j.message) msg = j.message; if (j.hint) msg += ` (${j.hint})`; } catch (e) { /* ignore */ }
    if (r.status === 401 || r.status === 403 || /permission denied|row-level security|jwt/i.test(msg)) msg += ` — the old tables are locked down. Run supabase/old_tables_read.sql in the SQL editor to give the publishable key read-only access, then try again.`;
    else if (r.status === 404 || r.status === 406 || /relation .* does not exist|could not find the table/i.test(msg)) msg += ` — the ${table} table was not found in that project.`;
    else if (r.status === 503 || r.status === 540 || /paused|not reachable/i.test(msg)) msg += ' — is the Supabase project paused? Open the dashboard and resume it.';
    return `${table}: ${msg}`;
  },

  /* ---------- apply (browser, needs Store) ---------- */
  storeLookup() {
    const idx = Store.getIndex();
    return {
      person: (emails, company) => { for (const e of emails) { const p = idx.byEmail.get(e); if (p) return p; } return (!emails.length && company) ? Store.findPersonByCompany(company) : null; },
      bounce: email => idx.bounces.has(email),
      ledger: email => idx.ledger.has(email),
    };
  },
  /* Snapshot first, then one begin/commit over people, bounces and ledger. onProgress(done, total). */
  async apply(plan, { onProgress = null } = {}) {
    if (!plan || !plan.writes) throw new Error('Nothing to import.');
    await Store.snapshot('before old Reach import');
    const tx = Store.begin(['people', 'bounces', 'ledger']);
    const res = { people: { added: 0, merged: 0 }, bounces: { created: 0, updated: 0 }, ledger: { created: 0, updated: 0 } };
    let done = 0; const total = plan.writes;
    const tick = async () => { if (++done % 200 === 0) { if (onProgress) onProgress(done, total); await yieldToPaint(); } };
    try {
      for (const r of plan.people.rows) {
        const { unknownReason, ...input } = r.input;
        const x = Store.upsertPerson(input);
        x.action === 'added' ? res.people.added++ : res.people.merged++;
        await tick();
      }
      /* addBounces takes one date per call: group by the day they bounced. An address already
         blocked here is left as it is (counted as known), so a second run never bumps its count. */
      const haveB = new Set(Store.state.bounces.map(b => b.email)), byDate = new Map();
      for (const b of plan.bounces.rows) {
        if (haveB.has(b.email)) { res.bounces.updated++; continue; }
        haveB.add(b.email);
        if (!byDate.has(b.date)) byDate.set(b.date, []); byDate.get(b.date).push(b);
      }
      for (const [date, list] of byDate) {
        const r = Store.addBounces(list.map(b => ({ email: b.email, type: b.type, reason: b.reason })), { date, source: 'old reach' });
        res.bounces.created += r.created;
        done += list.length; if (onProgress) onProgress(done, total); await yieldToPaint();
      }
      /* rememberSent creates the rows (one call per first-sent date); then widen first/last and keep the
         higher count so an address already here is updated rather than counted again. */
      const have = new Map(Store.state.ledger.map(l => [l.email, l]));
      const byFirst = new Map();
      for (const l of plan.ledger.rows) {
        if (have.has(l.email)) continue;
        if (!byFirst.has(l.first)) byFirst.set(l.first, []); byFirst.get(l.first).push(l.email);
      }
      for (const [date, emails] of byFirst) { const r = Store.rememberSent(emails, { date }); res.ledger.created += r.created; }
      const now = new Map(Store.state.ledger.map(l => [l.email, l]));
      for (const l of plan.ledger.rows) {
        const x = now.get(l.email); if (!x) continue;
        const existed = have.has(l.email);
        if (l.first && (!x.first || l.first < x.first)) x.first = l.first;
        if (l.last && (!x.last || l.last > x.last)) x.last = l.last;
        if (l.count > (x.count || 0)) x.count = l.count;
        if (existed) res.ledger.updated++;
        await tick();
      }
      Store.index = null;
    } catch (e) {
      /* roll the in-memory state back; nothing was flushed yet */
      for (const c of tx.colls) Store.state[c] = tx.before[c];
      Store.index = null;
      throw e;
    }
    const text = `Imported from the old Reach (Supabase): ${res.people.added} people added, ${res.people.merged} merged; ${res.bounces.created} bounced addresses added, ${res.bounces.updated} already known; ${res.ledger.created} mailed addresses added, ${res.ledger.updated} updated.`;
    await Store.commit(tx, { label: 'Import from the old Reach', type: 'import', text });
    await Store.saveSettings({ oldReachImport: { at: nowISO(), people: res.people.added + res.people.merged, bounces: plan.bounces.rows.length, ledger: plan.ledger.rows.length } });
    return res;
  },
};
