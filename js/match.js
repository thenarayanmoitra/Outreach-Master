/* =============================================================================
   Reach — matching engine
   Email normalisation, company / name / domain matching, bounce parsing and the
   screening rules that decide what happens to every row of a list.
   ============================================================================= */
'use strict';

/* ============================= STATUSES =============================
   One status per person. Colours follow the Response Tracker: green = client,
   yellow = warm, red = closed for now, orange = past client. */
const STATUSES = {
  client:   { label: 'Client',          short: 'Client',   color: 'var(--s-client)',   bg: 'var(--s-client-bg)',   desc: 'Working together now. Never cold-mailed.', order: 0 },
  warm:     { label: 'Warm',            short: 'Warm',     color: 'var(--s-warm)',     bg: 'var(--s-warm-bg)',     desc: 'Replied with interest, in conversation.', order: 1 },
  pipeline: { label: 'In pipeline',     short: 'Pipeline', color: 'var(--s-pipeline)', bg: 'var(--s-pipeline-bg)', desc: 'Proposal or audit sent, waiting on them.', order: 2 },
  notnow:   { label: 'Not now',         short: 'Not now',  color: 'var(--s-notnow)',   bg: 'var(--s-notnow-bg)',   desc: 'Closed for now. Set a revisit date to re-reach later.', order: 3 },
  past:     { label: 'Past client',     short: 'Past',     color: 'var(--s-past)',     bg: 'var(--s-past-bg)',     desc: 'Worked together before.', order: 4 },
  dnc:      { label: 'Do not contact',  short: 'DNC',      color: 'var(--s-dnc)',      bg: 'var(--s-dnc-bg)',      desc: 'Asked you to stop, or must never be mailed.', order: 5 },
};
const STATUS_KEYS = Object.keys(STATUSES);
const STATUS_STRENGTH = { dnc: 6, client: 5, warm: 4, pipeline: 3, past: 2, notnow: 1 };

/* Verdict kinds: block (left out), ask (left out unless you tick it), allow (in, with a note), none */
const VERDICT = { block: 3, ask: 2, allow: 1, none: 0 };

/* Reason catalogue. Each screening row collects one or more reasons; the
   strongest decides the verdict. */
const REASONS = {
  invalid:   { label: 'No valid email',     icon: 'x',       color: 'var(--grey)',   kind: 'block', desc: 'The row has no usable address.' },
  dup:       { label: 'Duplicate in list',  icon: 'copy',    color: 'var(--grey)',   kind: 'block', desc: 'Same address appears earlier in this list.' },
  person:    { label: 'In your memory',     icon: 'user',    color: 'var(--red)',    kind: 'rule',  desc: 'This exact address is in your memory.' },
  bounced:   { label: 'Bounced',            icon: 'mailx',   color: 'var(--red)',    kind: 'rule',  desc: 'This address bounced before.' },
  mailed:    { label: 'Mailed before',      icon: 'repeat',  color: 'var(--blue)',   kind: 'rule',  desc: 'You already sent to this address.' },
  domain:    { label: 'Same company domain',icon: 'globe',   color: 'var(--amber)',  kind: 'rule',  desc: 'Someone at this email domain is in your memory.' },
  company:   { label: 'Same company name',  icon: 'building',color: 'var(--amber)',  kind: 'rule',  desc: 'The company name matches one in your memory.' },
  name:      { label: 'Same contact name',  icon: 'user',    color: 'var(--amber)',  kind: 'rule',  desc: 'The contact name matches one in your memory.' },
  role:      { label: 'Role address',       icon: 'info',    color: 'var(--grey)',   kind: 'rule',  desc: 'info@, sales@, hello@ and similar.' },
  freemail:  { label: 'Free mailbox',       icon: 'info',    color: 'var(--grey)',   kind: 'info',  desc: 'gmail, yahoo, outlook… company matching can’t use the domain.' },
};

const FREE_EMAIL_DOMAINS_DEFAULT = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'yahoo.in', 'yahoo.com.ph', 'yahoo.com.sg', 'yahoo.com.au', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'icloud.com', 'aol.com', 'protonmail.com', 'proton.me', 'live.com', 'yandex.com', 'mail.com', 'gmx.com', 'gmx.de', 'me.com', 'msn.com', 'rediffmail.com', 'zoho.com', 'ymail.com', 'hey.com', 'fastmail.com', 'qq.com', '163.com', '126.com', 'mail.ru', 'web.de'];
const ROLE_LOCALS_DEFAULT = ['info', 'sales', 'contact', 'hello', 'hi', 'admin', 'support', 'office', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'reservations', 'reservation', 'bookings', 'booking', 'marketing', 'team', 'hr', 'careers', 'jobs', 'press', 'media', 'mail', 'email', 'general', 'help', 'service', 'customerservice', 'customer.service', 'partnerships', 'partners', 'business', 'newsletter', 'webmaster', 'noreply', 'no-reply', 'donotreply'];
const COMPANY_SUFFIXES_DEFAULT = ['pvt ltd', 'pvt. ltd', 'private limited', 'pte ltd', 'pte. ltd', 'ltd', 'limited', 'llc', 'llp', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'group', 'groups', 'travel', 'travels', 'tours', 'tour', 'tourism', 'dmc', 'gmbh', 'sarl', 'plc', 'holdings', 'enterprises', 'enterprise', 'associates', 'associate', 'agency', 'agencies', 'association', 'associations', 'alliance', 'federation', 'network', 'networks', 'media', 'resort', 'resorts', 'hotel', 'hotels', 'solutions', 'partners', 'ventures', 'coalition', 'council', 'society', 'foundation', 'chamber', 'expeditions', 'expedition', 'adventures', 'adventure', 'international', 'global', 'the'];
const TWO_LEVEL_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'co.in', 'net.in', 'org.in', 'ac.in', 'edu.in', 'gov.in', 'co.nz', 'org.nz', 'co.za', 'com.au', 'net.au', 'org.au', 'edu.au', 'com.sg', 'edu.sg', 'com.ph', 'edu.ph', 'org.ph', 'co.th', 'ac.th', 'or.th', 'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'com.br', 'com.mx', 'com.ar', 'com.vn', 'edu.vn', 'org.vn', 'edu.np', 'com.np', 'org.np', 'com.my', 'com.hk', 'com.tw', 'com.tr', 'com.pk', 'edu.pk', 'com.bd', 'com.lk', 'co.id', 'or.id', 'ac.id', 'co.kr', 'or.kr', 'com.cn', 'org.cn', 'com.eg', 'co.ke', 'com.ng', 'co.il', 'com.ua', 'com.pe', 'com.co', 'com.ec', 'com.uy']);

/* ============================= EMAIL ============================= */
const ZW_RE = /[​‌‍⁠﻿]/g;
const NBSP_RE = /[   ]/g;
const EDGE_CHARS = ' \t\n\v\f\r<>"\'`,;()[]';
function trimChars(s, chars) { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); }
function normEmail(raw) {
  if (raw == null) return { email: '', valid: false };
  let s = String(raw).replace(ZW_RE, '').replace(NBSP_RE, ' ');
  let prev;
  do { prev = s; s = trimChars(s, EDGE_CHARS); if (s.slice(0, 7).toLowerCase() === 'mailto:') s = s.slice(7); } while (s !== prev);
  s = s.toLowerCase();
  const dom = s.split('@')[1] || '';
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && !/(^\.|\.$|\.\.)/.test(dom) && !/[,;<>()[\]"']/.test(s);
  return { email: valid ? s : '', valid };
}
function emailDomain(norm) { const i = (norm || '').lastIndexOf('@'); return i > -1 ? norm.slice(i + 1) : ''; }
function emailLocal(norm) { const i = (norm || '').indexOf('@'); return i > -1 ? norm.slice(0, i) : norm || ''; }
/* "mail.company.co.uk" -> "company.co.uk"; "www.company.com" -> "company.com" */
function rootDomain(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = d.split('.');
  if (parts.length <= 2) return d;
  const last2 = parts.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(last2) && parts.length >= 3) return parts.slice(-3).join('.');
  return last2;
}
function domainFromWebsite(url) {
  let s = String(url || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[\/?#:]/)[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return '';
  return rootDomain(s);
}
/* Every email-looking token in a sheet cell, in order. "Name <a@x.com>" gives
   a@x.com; "a@x.com / b@y.com" gives both. */
const EMAILISH_RE = /[^\s<>()[\]{}"'`,;:|\\/]+@[^\s<>()[\]{}"'`,;:|\\/]+/g;
function cellEmails(cell) {
  const s = String(cell == null ? '' : cell);
  if (!s.includes('@')) return [];
  const out = [], seen = new Set();
  for (const t of s.match(EMAILISH_RE) || []) {
    const raw = t.replace(/\.+$/, '').replace(/^mailto:/i, '');
    const n = normEmail(raw);
    const key = n.valid ? n.email : raw;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}
/* Paste boxes accept anything: bounce notifications, a column, a comma list. */
const SYSTEM_LOCAL_RE = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|bounce\+.*|mail-?noreply|abuse|mailer)$/i;
function isSystemAddress(norm) {
  const [local, dom] = norm.split('@');
  return SYSTEM_LOCAL_RE.test(local) || local.length > 48 || /[=$]/.test(local) || /^(mail|smtp|mx|bounce)[0-9.-]*\./.test(dom) || dom === 'mail.gmail.com';
}
function extractEmails(text, { skipSystem = false } = {}) {
  const found = (String(text || '').match(EMAILISH_RE) || []).map(t => t.replace(/\.+$/, '').replace(/^mailto:/i, ''));
  const valid = [], invalid = [], ignored = [], seen = new Set(), seenBad = new Set();
  for (const t of found) {
    const n = normEmail(t);
    if (n.valid) {
      if (seen.has(n.email)) continue;
      seen.add(n.email);
      if (skipSystem && isSystemAddress(n.email)) ignored.push(n.email); else valid.push(n.email);
    } else if (!seenBad.has(t)) { seenBad.add(t); invalid.push(t); }
  }
  return { valid, invalid, ignored };
}
/* "From: Grace Kang <grace@greenview.sg>" or "Grace Kang grace@greenview.sg" -> { name, email } */
function parseFromLine(text) {
  const s = String(text || '').replace(/^\s*(from|to|cc|reply-to)\s*:\s*/i, '').trim();
  const m = s.match(EMAILISH_RE);
  if (!m) return { name: s, email: '' };
  const email = normEmail(m[0]).email;
  let name = s.replace(m[0], '').replace(/mailto:/ig, '').replace(/[<>"'()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[,;:\-–]+|[,;:\-–]+$/g, '').trim();
  return { name, email };
}

/* ============================= COMPANY / NAME ============================= */
let _sufCache = { key: '', list: [] };
function cleanCompany(name, suffixes = COMPANY_SUFFIXES_DEFAULT) {
  let s = String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const key = suffixes.join('|');
  if (_sufCache.key !== key) _sufCache = { key, list: suffixes.map(suf => new RegExp('\\b' + suf.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '$')) };
  let changed = true, guard = 0;
  while (changed && guard++ < 12) {
    changed = false;
    for (const re of _sufCache.list) {
      if (re.test(s)) { const r = s.replace(re, '').trim(); if (r) { s = r; changed = true; } }
    }
  }
  return s;
}
function wordContains(long, short) { return short.length >= 4 && long.length > short.length && (' ' + long + ' ').includes(' ' + short + ' '); }
const NAME_TITLES = /^(mr|mrs|ms|miss|dr|prof|sir|madam|mx)\.?\s+/i;
function nameKey(name) {
  let s = String(name || '').replace(/\(.*?\)/g, ' ').replace(NAME_TITLES, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
function nameWords(key) { return key ? key.split(' ').filter(w => w.length > 1) : []; }

/* ============================= PEOPLE HELPERS ============================= */
function personEmails(p) { return Array.isArray(p.emails) ? p.emails : []; }
function personDomains(p, freeSet) {
  const out = new Set();
  for (const e of personEmails(p)) { const d = rootDomain(emailDomain(e)); if (d && !freeSet.has(d) && !freeSet.has(emailDomain(e))) out.add(d); }
  if (p.domain) { const d = rootDomain(p.domain); if (d && !freeSet.has(d)) out.add(d); }
  return [...out];
}
function personLabel(p) { return (p.company || '').trim() || (p.name || '').trim() || personEmails(p)[0] || '(unnamed)'; }
function personSub(p) { const parts = []; if (p.company && p.name) parts.push(p.name); const e = personEmails(p); if (e.length) parts.push(e[0] + (e.length > 1 ? ` +${e.length - 1}` : '')); return parts.join(' · '); }
function strongerStatus(a, b) { return (STATUS_STRENGTH[a] || 0) >= (STATUS_STRENGTH[b] || 0) ? a : b; }

/* ============================= INDEX =============================
   Built from the whole memory. Fast enough to rebuild on every change: a few
   thousand people and tens of thousands of ledger rows take milliseconds. */
function buildIndex(db, settings) {
  const freeSet = new Set((settings.freeDomains || FREE_EMAIL_DOMAINS_DEFAULT).map(d => d.toLowerCase()));
  const suffixes = settings.suffixes || COMPANY_SUFFIXES_DEFAULT;
  const byEmail = new Map(), byDomain = new Map(), byCompany = new Map(), byName = new Map(), companies = [];
  for (const p of db.people) {
    for (const e of personEmails(p)) if (!byEmail.has(e)) byEmail.set(e, p);
    for (const d of personDomains(p, freeSet)) { const a = byDomain.get(d) || []; a.push(p); byDomain.set(d, a); }
    const clean = cleanCompany(p.company, suffixes);
    if (clean.length >= 3) { const a = byCompany.get(clean) || []; a.push(p); byCompany.set(clean, a); companies.push({ p, clean }); }
    const nk = nameKey(p.name);
    if (nameWords(nk).length >= 2) { const a = byName.get(nk) || []; a.push(p); byName.set(nk, a); }
  }
  const bounces = new Map();
  for (const b of db.bounces) if (b.email && !bounces.has(b.email)) bounces.set(b.email, b);
  const ledger = new Map();
  for (const l of db.ledger) if (l.email) ledger.set(l.email, l);
  const roleSet = new Set((settings.roleLocals || ROLE_LOCALS_DEFAULT).map(s => s.toLowerCase()));
  return { byEmail, byDomain, byCompany, byName, companies, bounces, ledger, freeSet, suffixes, roleSet, builtAt: Date.now() };
}
function lookupEverything(idx, q) {
  // Used by the global search: exact email, or substring on company/name/email
  const s = String(q || '').trim().toLowerCase();
  if (!s) return { people: [], bounce: null, ledger: null, domainPeople: [] };
  const n = normEmail(s);
  const out = { people: [], bounce: null, ledger: null, domainPeople: [] };
  if (n.valid) {
    const p = idx.byEmail.get(n.email); if (p) out.people.push(p);
    out.bounce = idx.bounces.get(n.email) || null;
    out.ledger = idx.ledger.get(n.email) || null;
    const d = rootDomain(emailDomain(n.email));
    if (!idx.freeSet.has(d)) out.domainPeople = (idx.byDomain.get(d) || []).filter(p => !out.people.includes(p));
  }
  return out;
}

/* ============================= SCREENING =============================
   items: [{ i, row, raw, email, valid, domain, company, name, website }]
   Mutates each item: reasons[], verdict, primary, include, match info. */
function defaultRules() {
  return {
    status:  { client: 'block', warm: 'block', pipeline: 'block', notnow: 'block', past: 'block', dnc: 'block' },
    domain:  { client: 'block', warm: 'block', pipeline: 'ask',   notnow: 'ask',   past: 'ask',   dnc: 'block' },
    company: { client: 'ask',   warm: 'ask',   pipeline: 'ask',   notnow: 'ask',   past: 'ask',   dnc: 'ask' },
    name:    'ask',
    notnowAfterRevisit: 'ask',    // a Not now whose revisit date has passed
    bounceHard: 'block', bounceSoft: 'ask',
    mailed: 'ask', mailedCooldownDays: 90, mailedAfterCooldown: 'allow',
    role: 'allow', freemail: 'info',
  };
}
function screenItems(items, idx, settings, today = todayISO()) {
  const rules = Object.assign(defaultRules(), settings.rules || {});
  for (const k of ['status', 'domain', 'company']) rules[k] = Object.assign(defaultRules()[k], (settings.rules || {})[k] || {});
  const seen = new Map();
  for (const it of items) {
    it.reasons = []; it.matches = []; it.primary = null; it.verdict = 'none';
    if (!it.valid) { addReason(it, 'invalid', 'block', it.raw ? `Not an email address: ${it.raw}` : 'No email address in this row'); finish(it); continue; }
    const first = seen.get(it.email);
    if (first) { it.dupOf = first; addReason(it, 'dup', 'block', `Already on row ${first.row.n} of this list`); }
    else seen.set(it.email, it);
    const domain = rootDomain(it.domain);
    const isFree = idx.freeSet.has(domain) || idx.freeSet.has(it.domain);
    // 1. exact person
    const p = idx.byEmail.get(it.email);
    if (p) {
      let level = rules.status[p.status] || 'block';
      let why = `${STATUSES[p.status]?.label || p.status}: ${personLabel(p)}`;
      if (p.status === 'notnow' && p.revisit_on && p.revisit_on <= today) { level = rules.notnowAfterRevisit; why += ` — revisit date ${fmtDate(p.revisit_on)} has passed`; }
      else if (p.status === 'notnow' && p.revisit_on) why += ` — revisit after ${fmtDate(p.revisit_on)}`;
      addReason(it, 'person', level, why, { person: p });
    }
    // 2. bounced
    const b = idx.bounces.get(it.email);
    if (b) addReason(it, 'bounced', b.type === 'soft' ? rules.bounceSoft : rules.bounceHard, `${b.type === 'soft' ? 'Soft' : 'Hard'} bounce on ${fmtDate(b.bounced_at)}${b.reason ? ' — ' + b.reason.slice(0, 80) : ''}`, { bounce: b });
    // 3. mailed before
    const l = idx.ledger.get(it.email);
    if (l) {
      const days = daysBetween(l.last, today);
      const cool = days != null && days > (rules.mailedCooldownDays || 0);
      addReason(it, 'mailed', cool ? rules.mailedAfterCooldown : rules.mailed, `Mailed ${l.count === 1 ? 'once' : l.count + ' times'}, last on ${fmtDate(l.last)}${days != null ? ` (${days} days ago)` : ''}`, { ledger: l });
    }
    // 4. same corporate domain (also from a website column when the email is free-mail)
    const domains = new Set();
    if (domain && !isFree) domains.add(domain);
    if (it.website) { const wd = domainFromWebsite(it.website); if (wd && !idx.freeSet.has(wd)) domains.add(wd); }
    for (const d of domains) {
      for (const q of idx.byDomain.get(d) || []) {
        if (q === p) continue;
        addReason(it, 'domain', rules.domain[q.status] || 'ask', `Same domain @${d} as ${STATUSES[q.status]?.label.toLowerCase() || q.status} ${personLabel(q)}`, { person: q });
      }
    }
    // 5. same company name
    const clean = cleanCompany(it.company, idx.suffixes);
    if (clean.length >= 3) {
      const hits = new Map();
      for (const q of idx.byCompany.get(clean) || []) hits.set(q.id, { q, why: 'Same company name' });
      for (const { p: q, clean: c } of idx.companies) if (!hits.has(q.id) && (wordContains(c, clean) || wordContains(clean, c))) hits.set(q.id, { q, why: 'Similar company name' });
      for (const { q, why } of hits.values()) {
        if (q === p || it.matches.some(m => m.person === q)) continue;
        addReason(it, 'company', rules.company[q.status] || 'ask', `${why} as ${STATUSES[q.status]?.label.toLowerCase() || q.status} ${personLabel(q)}`, { person: q });
      }
    }
    // 6. same full contact name (two words or more)
    const nk = nameKey(it.name);
    if (nameWords(nk).length >= 2) for (const q of idx.byName.get(nk) || []) {
      if (q === p || it.matches.some(m => m.person === q)) continue;
      addReason(it, 'name', rules.name, `Same name as ${STATUSES[q.status]?.label.toLowerCase() || q.status} contact ${q.name} at ${q.company || 'unknown company'}`, { person: q });
    }
    // 7. role address / free mailbox (info only unless the rule says otherwise)
    if (idx.roleSet.has(emailLocal(it.email))) addReason(it, 'role', rules.role, `Generic mailbox ${emailLocal(it.email)}@ — a person may never read it`);
    if (isFree) addReason(it, 'freemail', rules.freemail === 'info' ? 'allow' : rules.freemail, `Free mailbox: company matching skipped`);
    finish(it);
  }
  return items;
  function addReason(it, key, level, text, extra = {}) {
    const lvl = level === 'info' ? 'allow' : (level || 'ask');
    it.reasons.push({ key, level: lvl, text, ...extra });
    if (extra.person) it.matches.push({ person: extra.person, key, why: text });
  }
  function finish(it) {
    let best = 'none', primary = null;
    for (const r of it.reasons) if (VERDICT[r.level] > VERDICT[best]) { best = r.level; primary = r; }
    // allow-level reasons never decide the verdict on their own
    it.verdict = best === 'allow' ? 'ready' : (best === 'none' ? 'ready' : best);
    it.primary = primary && VERDICT[primary.level] >= VERDICT.ask ? primary : null;
    it.flags = it.reasons.filter(r => r.level === 'allow');
    it.include = it.verdict === 'ready';
    it.forced = false;
  }
}
function screenCounts(items) {
  const n = { all: items.length, ready: 0, ask: 0, block: 0, included: 0 };
  for (const k of Object.keys(REASONS)) n[k] = 0;
  for (const it of items) { n[it.verdict]++; if (it.include) n.included++; for (const r of it.reasons) n[r.key]++; }
  return n;
}
/* Which rows of the sheet each item belongs to, for the exports */
function guessColumns(table) {
  const H = table.headers.map(h => h.toLowerCase().trim());
  const sample = table.rows.slice(0, 400);
  const score = i => sample.reduce((a, r) => a + (cellEmails(r.cells[i]).length ? 1 : 0), 0);
  let email = -1, best = 0;
  for (let i = 0; i < H.length; i++) { const s = score(i); if (s > best) { best = s; email = i; } }
  if (email < 0) email = H.findIndex(h => /e-?mail/.test(h));
  const find = (res, skip = []) => { for (const re of res) { const i = H.findIndex((h, j) => !skip.includes(j) && re.test(h)); if (i > -1) return i; } return -1; };
  const company = find([/^(company|organisation|organization|org|business|brand|account|employer)/, /company|organi[sz]ation|business|agency|hotel|dmc|property|firm|operator/, /^name$/], [email]);
  let name = find([/contact|poc|person|full ?name|first ?name|^name$|^names?$|^who$/], [email, company]);
  if (name === company) name = -1;
  const first = find([/first ?name|^first$|given/], [email, company]);
  const last = find([/last ?name|^last$|surname|family/], [email, company, first]);
  const website = find([/website|web ?site|url|domain|site$/], [email, company, name]);
  return { email, company, name: name > -1 ? name : first, last: name > -1 ? -1 : last, website };
}
function itemsFromTable(table, map) {
  const items = [];
  for (const row of table.rows) {
    const company = map.company > -1 ? String(row.cells[map.company] || '').trim() : '';
    let name = map.name > -1 ? String(row.cells[map.name] || '').trim() : '';
    if (map.last > -1 && row.cells[map.last]) name = (name + ' ' + String(row.cells[map.last]).trim()).trim();
    const website = map.website > -1 ? String(row.cells[map.website] || '').trim() : '';
    const parts = map.email > -1 ? cellEmails(row.cells[map.email]) : [];
    if (!parts.length) { items.push({ i: items.length, row, raw: map.email > -1 ? String(row.cells[map.email] || '').trim() : '', email: '', valid: false, domain: '', company, name, website }); continue; }
    for (const part of parts) {
      const n = normEmail(part);
      items.push({ i: items.length, row, raw: part, email: n.email, valid: n.valid, domain: n.valid ? emailDomain(n.email) : '', company, name, website });
    }
  }
  return items;
}

/* ============================= BOUNCE TEXT =============================
   Tries to pull a reason out of pasted bounce notifications, per address. */
const BOUNCE_HINTS = [
  [/user unknown|no such user|does not exist|doesn't exist|unknown user|recipient rejected|invalid recipient|address rejected|not found|no mailbox|mailbox unavailable|550 5\.1\.1|5\.1\.1|unrouteable|unknown address/i, 'hard', 'Address does not exist'],
  [/domain.*not found|no mx|host unknown|dns|5\.1\.2|5\.4\.4/i, 'hard', 'Domain does not exist'],
  [/mailbox full|quota|over quota|4\.2\.2|5\.2\.2/i, 'soft', 'Mailbox full'],
  [/temporar|try again|greylist|4\.\d\.\d|deferred|delayed/i, 'soft', 'Temporary failure'],
  [/blocked|spam|blacklist|reputation|policy|5\.7\.\d/i, 'soft', 'Blocked or marked as spam'],
  [/out of office|auto.?reply|automatic reply|away from/i, 'soft', 'Auto-reply, not a bounce'],
];
function classifyBounceText(text) {
  for (const [re, type, reason] of BOUNCE_HINTS) if (re.test(text)) return { type, reason };
  return { type: 'hard', reason: '' };
}
function parseBouncePaste(text, { skipSystem = true } = {}) {
  const ex = extractEmails(text, { skipSystem });
  const blocks = String(text || '').split(/\n\s*\n|(?=^from:)/im);
  const info = new Map();
  for (const block of blocks) {
    const emails = extractEmails(block, { skipSystem }).valid;
    if (!emails.length) continue;
    const c = classifyBounceText(block);
    for (const e of emails) if (!info.has(e) || (info.get(e).type === 'hard' && !info.get(e).reason)) info.set(e, c);
  }
  return { ...ex, info };
}
