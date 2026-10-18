#!/usr/bin/env node
/* Reach — checks the import from the old Reach (js/migrate.js) with sample rows.
     node check/old-reach-check.js
   Loads util.js, match.js and migrate.js the way the browser does (classic scripts
   sharing one global scope), then checks the reason → status mapping, the row
   mappers, the preview plan against a stub of what is already in memory, and the
   paged REST reader against a mock fetch. Ends with process.exit(0) because util.js
   opens a MessageChannel, which would otherwise keep Node alive. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const root = path.join(__dirname, '..');
const bundle = ['js/util.js', 'js/match.js', 'js/migrate.js'].map(f => `/* ${f} */\n` + fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
vm.runInThisContext(bundle, { filename: 'reach-bundle.js' });
const { OldReach, STATUSES, OLD_REACH_TABLES } = vm.runInThisContext('({ OldReach, STATUSES, OLD_REACH_TABLES })');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

/* ---------- reason → status ---------- */
eq(OldReach.reasonToStatus('Client'), 'client', 'Client → client');
eq(OldReach.reasonToStatus('Replied'), 'warm', 'Replied → warm');
eq(OldReach.reasonToStatus('Do not contact'), 'dnc', 'Do not contact → dnc');
eq(OldReach.reasonToStatus('  do NOT contact '), 'dnc', 'case and spaces do not matter');
eq(OldReach.reasonToStatus('Something else'), null, 'unknown reason → null');
eq(OldReach.reasonToStatus(''), null, 'empty reason → null');
for (const s of ['client', 'warm', 'dnc']) ok(STATUSES[s], `${s} is a Reach status`);

/* ---------- sample rows, shaped like the old tables ---------- */
const sample = {
  never_mail: [
    { id: 'n1', email_norm: 'suman@explorehimalayas.com', email_domain: 'explorehimalayas.com', reason: 'Client', company_name: 'Kipling India Travels', contact_person: 'Suman', note: 'Got hired.', added_at: '2026-03-12' },
    { id: 'n2', email_norm: 'Ana@NewDMC.example', email_domain: 'newdmc.example', reason: 'Replied', company_name: 'New DMC', contact_person: 'Ana', note: 'Asked for rates', added_at: '2026-05-02' },
    { id: 'n3', email_norm: 'stop@nomore.example', email_domain: 'nomore.example', reason: 'Do not contact', company_name: '', contact_person: '', note: '', added_at: '2026-06-01' },
    { id: 'n4', email_norm: '', email_domain: '', reason: 'Client', company_name: 'Company Only Pvt Ltd', contact_person: '', note: 'Known by company only', added_at: '2026-01-10' },
    { id: 'n5', email_norm: '', email_domain: '', reason: 'Client', company_name: 'Company Only Private Limited', contact_person: 'Rita', note: '', added_at: '2026-01-11' },
    { id: 'n6', email_norm: 'not-an-email', email_domain: '', reason: 'Replied', company_name: '', contact_person: '', note: '', added_at: '2026-02-02' },
    { id: 'n7', email_norm: 'odd@x.example', email_domain: 'x.example', reason: 'Something else', company_name: 'Odd Co', contact_person: '', note: '', added_at: null },
  ],
  bounce_suppression: [
    { email_norm: 'dead@x.example', bounced_at: '2026-04-01' },
    { email_norm: 'dead@x.example', bounced_at: '2026-04-09' },
    { email_norm: 'known@bounced.example', bounced_at: '2026-02-02' },
    { email_norm: '', bounced_at: '2026-02-03' },
  ],
  sent_ledger: [
    { email_norm: 'a@sent.example', email_domain: 'sent.example', first_sent_at: '2026-01-01', last_sent_at: '2026-03-01', send_count: 3 },
    { email_norm: 'b@sent.example', email_domain: 'sent.example', first_sent_at: null, last_sent_at: '2026-02-02', send_count: 0 },
    { email_norm: 'c@sent.example', email_domain: 'sent.example', first_sent_at: '2026-03-01', last_sent_at: '2026-01-01', send_count: 2 },
    { email_norm: 'known@sent.example', email_domain: 'sent.example', first_sent_at: '2025-12-01', last_sent_at: '2025-12-01', send_count: 1 },
    { email_norm: 'nope', email_domain: '', first_sent_at: '2026-01-01', last_sent_at: '2026-01-01', send_count: 1 },
  ],
};

/* ---------- row mappers ---------- */
const p1 = OldReach.mapPerson(sample.never_mail[0]);
eq(p1.emails, ['suman@explorehimalayas.com'], 'email kept');
eq(p1.status, 'client', 'Client row → client');
eq(p1.company, 'Kipling India Travels'); eq(p1.name, 'Suman'); eq(p1.note, 'Got hired.');
eq(p1.first_contact, '2026-03-12', 'added_at → first_contact'); eq(p1.last_reply, '', 'clients get no last_reply');
eq(p1.source, 'Old Reach (Supabase)'); eq(p1.historyType, 'import');
ok(/never_mail: Client/.test(p1.historyNote), 'history note names the old reason');
eq(p1.unknownReason, false);
const p2 = OldReach.mapPerson(sample.never_mail[1]);
eq(p2.emails, ['ana@newdmc.example'], 'email normalised to lower case');
eq(p2.status, 'warm', 'Replied row → warm'); eq(p2.last_reply, '2026-05-02', 'Replied rows get last_reply from added_at');
eq(OldReach.mapPerson(sample.never_mail[2]).status, 'dnc', 'Do not contact row → dnc');
const p4 = OldReach.mapPerson(sample.never_mail[3]);
eq(p4.emails, [], 'company-only row has no email'); eq(p4.company, 'Company Only Pvt Ltd'); eq(p4.status, 'client');
eq(OldReach.mapPerson(sample.never_mail[5]), null, 'row with a bad email and no company is skipped');
const p7 = OldReach.mapPerson(sample.never_mail[6]);
eq(p7.status, 'dnc', 'unknown reason falls back to dnc'); eq(p7.unknownReason, true); eq(p7.first_contact, '', 'null added_at → empty');
eq(OldReach.mapPerson(null), null); eq(OldReach.mapPerson({}), null);

const b1 = OldReach.mapBounce(sample.bounce_suppression[0]);
eq(b1, { email: 'dead@x.example', type: 'hard', reason: 'Bounced in the old Reach', date: '2026-04-01' }, 'bounce row → hard bounce with its date');
eq(OldReach.mapBounce(sample.bounce_suppression[3]), null, 'empty bounce address is skipped');
ok(/^\d{4}-\d{2}-\d{2}$/.test(OldReach.mapBounce({ email_norm: 'x@y.example' }).date), 'missing bounced_at falls back to today');

eq(OldReach.mapLedger(sample.sent_ledger[0]), { email: 'a@sent.example', first: '2026-01-01', last: '2026-03-01', count: 3 }, 'ledger row keeps dates and count');
eq(OldReach.mapLedger(sample.sent_ledger[1]), { email: 'b@sent.example', first: '2026-02-02', last: '2026-02-02', count: 1 }, 'missing first date and zero count are repaired');
eq(OldReach.mapLedger(sample.sent_ledger[2]), { email: 'c@sent.example', first: '2026-01-01', last: '2026-03-01', count: 2 }, 'swapped dates are put in order');
eq(OldReach.mapLedger(sample.sent_ledger[4]), null, 'invalid ledger address is skipped');

/* ---------- preview plan against a stub of what is already here ---------- */
const seedPerson = { id: 'seed-001', company: 'Kipling India Travels', name: 'Suman', emails: ['suman@explorehimalayas.com'], status: 'client' };
const lookup = {
  person: (emails, company) => emails.includes('suman@explorehimalayas.com') ? seedPerson : null,
  bounce: e => e === 'known@bounced.example',
  ledger: e => e === 'known@sent.example',
};
const plan = OldReach.plan(sample, lookup);
eq(plan.people.total, 7); eq(plan.people.skipped, 1, 'one never_mail row skipped'); eq(plan.people.rows.length, 6);
eq(plan.people.add, 4, 'four new people'); eq(plan.people.merge, 2, 'one merges into the seed, one into an earlier row of the import');
eq(plan.people.byStatus, { client: 3, warm: 1, dnc: 2 }, 'status breakdown');
eq(plan.people.unknownReason, 1);
eq(plan.people.rows[0].existing, seedPerson, 'seed match is kept for the preview');
eq(plan.people.rows[4].within, true, 'same company as an earlier row counts as a merge');
eq(plan.bounces.total, 4); eq(plan.bounces.skipped, 1); eq(plan.bounces.add, 1); eq(plan.bounces.update, 2, 'duplicate in the batch + one already here');
eq(plan.ledger.total, 5); eq(plan.ledger.skipped, 1); eq(plan.ledger.add, 3); eq(plan.ledger.update, 1);
eq(plan.writes, 6 + 3 + 4, 'writes = rows that will be written');
const lines = OldReach.summary(plan);
eq(lines.length, 3, 'one summary line per table');
ok(/6 people .*4 new, 2 merge/.test(lines[0]), 'people summary: ' + lines[0]);
ok(/3 bounced addresses: 1 new, 2 already known, 1 skipped/.test(lines[1]), 'bounce summary: ' + lines[1]);
ok(/4 mailed addresses: 3 new, 1 already known, 1 skipped/.test(lines[2]), 'ledger summary: ' + lines[2]);
const empty = OldReach.plan({}, {});
eq(empty.writes, 0, 'empty tables → nothing to write'); eq(OldReach.summary(empty).length, 3);

/* ---------- paged REST reader against a mock fetch ---------- */
(async () => {
  const calls = [];
  const rows = Array.from({ length: 2500 }, (_, i) => ({ email_norm: `u${i}@paged.example`, bounced_at: '2026-01-01' }));
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url); calls.push(u);
    assert.strictEqual(opts.headers.apikey, 'sb_publishable_test_key_0123456789', 'apikey header sent');
    assert.strictEqual(opts.headers.Authorization, 'Bearer sb_publishable_test_key_0123456789', 'bearer header sent');
    if (u.pathname.endsWith('/locked')) return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ message: 'permission denied for table locked' }) };
    const limit = +u.searchParams.get('limit'), offset = +u.searchParams.get('offset');
    return { ok: true, status: 200, statusText: 'OK', json: async () => rows.slice(offset, offset + limit) };
  };
  const cfg = { url: 'https://example.supabase.co/', key: 'sb_publishable_test_key_0123456789' };
  const seen = [];
  const got = await OldReach.fetchTable(cfg, 'bounce_suppression', n => seen.push(n));
  eq(got.length, 2500, 'all rows read across pages');
  eq(calls.length, 3, 'three requests of 1000');
  eq(calls.map(u => +u.searchParams.get('offset')), [0, 1000, 2000], 'offsets advance by 1000');
  eq(calls.map(u => u.searchParams.get('limit')), ['1000', '1000', '1000']);
  eq(calls[0].pathname, '/rest/v1/bounce_suppression', 'REST path, trailing slash on the URL trimmed');
  eq(calls[0].searchParams.get('order'), 'email_norm.asc', 'stable order for paging');
  eq(seen, [1000, 2000, 2500], 'progress after every page');
  const planned = OldReach.plan({ bounce_suppression: got }, {});
  eq(planned.bounces.add, 2500, 'preview against the mock response');

  OLD_REACH_TABLES.locked = { select: '*', order: 'id.asc' };
  await assert.rejects(OldReach.fetchTable(cfg, 'locked'), e => /old_tables_read\.sql/.test(e.message), 'a 401 points at supabase/old_tables_read.sql');
  checks++;
  assert.throws(() => OldReach.checkConfig({ url: '', key: '' }), /URL/, 'missing config is refused'); checks++;

  console.log(`old-reach-check: ${checks} checks passed`);
  process.exit(0);
})().catch(e => { console.error('old-reach-check FAILED:', e && e.message ? e.message : e); process.exit(1); });
