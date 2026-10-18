/* =============================================================================
   Reach — local-first store
   Everything lives in IndexedDB on this device. Optional vault passphrase
   encrypts every collection at rest (AES-256-GCM, key from PBKDF2-SHA256).
   Writes are debounced and transactional per collection; every user action
   gets an undo, deleted rows go to a trash, and daily snapshots are kept.
   ============================================================================= */
'use strict';

const DB_NAME = 'reach-v4';
const DB_VERSION = 1;
const COLLECTIONS = ['people', 'bounces', 'ledger', 'campaigns', 'activity', 'trash', 'settings'];
const PBKDF2_ITERATIONS = 310000;
const MAX_ACTIVITY = 500;
const MAX_UNDO = 40;
const MAX_SNAPSHOTS = 14;

function defaultSettings() {
  return {
    name: 'Pratim',
    theme: 'auto',
    rules: defaultRules(),
    freeDomains: FREE_EMAIL_DOMAINS_DEFAULT.slice(),
    roleLocals: ROLE_LOCALS_DEFAULT.slice(),
    suffixes: COMPANY_SUFFIXES_DEFAULT.slice(),
    lock: { autoLockMinutes: 15 },
    cloud: { enabled: false, url: 'https://xxtzyngtmrdaphbqbewu.supabase.co', key: 'sb_publishable_QM2NOybHPX5SupdQOn0cyw_hC7vF_UC', pass: '', auto: false, lastBackup: '', table: 'reach_backups' },
    exportFormat: 'xlsx',
    trashDays: 30,
    onboarded: false,
  };
}

/* ============================= crypto helpers ============================= */
const te = new TextEncoder(), td = new TextDecoder();
function b64enc(buf) { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function b64dec(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
async function deriveKey(pass, salt, iterations = PBKDF2_ITERATIONS) {
  const km = await crypto.subtle.importKey('raw', te.encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function encryptString(key, str) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(str));
  return { enc: 1, iv, ct };
}
async function decryptString(key, blob) {
  const iv = blob.iv instanceof Uint8Array ? blob.iv : b64dec(blob.iv);
  const ct = blob.ct instanceof ArrayBuffer || ArrayBuffer.isView(blob.ct) ? blob.ct : b64dec(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return td.decode(pt);
}
function blobToPortable(blob) { return { enc: 1, iv: b64enc(blob.iv), ct: b64enc(blob.ct) }; }
async function exportKeyB64(key) { return b64enc(await crypto.subtle.exportKey('raw', key)); }
async function importKeyB64(b64) { return crypto.subtle.importKey('raw', b64dec(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }

/* ============================= IndexedDB ============================= */
function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'ts' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('Could not open the local database'));
    req.onblocked = () => rej(new Error('The local database is open in another tab. Close it and reload.'));
  });
}
function idbGet(db, store, key) { return new Promise((res, rej) => { const r = db.transaction(store, 'readonly').objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function idbGetAll(db, store) { return new Promise((res, rej) => { const r = db.transaction(store, 'readonly').objectStore(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); }
function idbPutMany(db, store, entries) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite'); const os = tx.objectStore(store);
    for (const [k, v] of entries) { if (k === undefined) os.put(v); else os.put(v, k); }
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Write aborted'));
  });
}
function idbDelete(db, store, key) { return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
function idbClear(db, store) { return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }

/* ============================= Store ============================= */
const Store = {
  db: null,
  state: null,
  meta: null,
  key: null,
  locked: false,
  dirty: new Set(),
  listeners: new Set(),
  undoStack: [], redoStack: [],
  _flushTimer: null, _flushing: null, _pendingResolvers: [],
  saveState: 'saved',
  index: null,

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(type, detail) { for (const fn of this.listeners) { try { fn(type, detail); } catch (e) { console.error(e); } } },

  blankState() { return { people: [], bounces: [], ledger: [], campaigns: [], activity: [], trash: [], settings: defaultSettings() }; },

  async open() {
    this.db = await idbOpen();
    this.meta = (await idbGet(this.db, 'kv', 'meta')) || null;
    if (!this.meta) {
      // first launch: seed from the Response Tracker
      this.meta = { version: 1, encrypted: false, salt: '', check: null, created_at: nowISO(), updated_at: nowISO(), last_saved: '' };
      this.state = this.blankState();
      const seed = window.REACH_SEED;
      if (seed && Array.isArray(seed.people)) {
        this.state.people = deepClone(seed.people);
        this.state.activity.push({ id: uid(), ts: nowISO(), type: 'import', text: `Loaded ${seed.people.length} people from your Response Tracker as the starting memory.` });
      }
      await idbPutMany(this.db, 'kv', [['meta', this.meta]]);
      for (const c of COLLECTIONS) this.dirty.add(c);
      await this.flush();
      this.index = null;
      return { firstRun: true };
    }
    if (this.meta.encrypted) {
      const sk = sessionStorage.getItem('reach.sk');
      if (sk) { try { const key = await importKeyB64(sk); if (await this.verifyKey(key)) { this.key = key; await this.loadAll(); return { firstRun: false }; } } catch (e) { console.warn('session key rejected', e); } sessionStorage.removeItem('reach.sk'); }
      this.locked = true;
      return { firstRun: false, locked: true };
    }
    await this.loadAll();
    return { firstRun: false };
  },

  async verifyKey(key) { try { return (await decryptString(key, this.meta.check)) === 'reach-ok'; } catch (e) { return false; } },

  async unlock(pass, { remember = false } = {}) {
    const key = await deriveKey(pass, b64dec(this.meta.salt), this.meta.iterations || PBKDF2_ITERATIONS);
    if (!(await this.verifyKey(key))) return false;
    this.key = key; this.locked = false;
    if (remember) sessionStorage.setItem('reach.sk', await exportKeyB64(key));
    await this.loadAll();
    return true;
  },
  lock() {
    if (!this.meta.encrypted) return;
    sessionStorage.removeItem('reach.sk');
    this.key = null; this.locked = true; this.state = null; this.index = null; this.undoStack = []; this.redoStack = [];
    this.emit('lock');
  },

  async loadAll() {
    const st = this.blankState();
    for (const c of COLLECTIONS) {
      const raw = await idbGet(this.db, 'kv', c);
      if (raw == null) continue;
      let val = raw;
      if (raw && raw.enc) { if (!this.key) throw new Error('Vault is locked'); val = JSON.parse(await decryptString(this.key, raw)); }
      if (c === 'settings') st.settings = this.mergeSettings(val); else if (Array.isArray(val)) st[c] = val;
    }
    this.state = st;
    this.index = null;
    this.purgeTrash();
    this.emit('load');
  },
  mergeSettings(val) {
    const d = defaultSettings();
    const s = Object.assign(d, val || {});
    s.rules = Object.assign(defaultRules(), (val && val.rules) || {});
    for (const k of ['status', 'domain', 'company']) s.rules[k] = Object.assign(defaultRules()[k], ((val && val.rules) || {})[k] || {});
    s.lock = Object.assign(d.lock, (val && val.lock) || {});
    s.cloud = Object.assign(d.cloud, (val && val.cloud) || {});
    return s;
  },

  /* ---------- persistence ---------- */
  mark(...colls) { for (const c of colls) this.dirty.add(c); this.scheduleFlush(); },
  scheduleFlush() {
    this.saveState = 'dirty'; this.emit('save', 'dirty');
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush().catch(e => { console.error(e); this.saveState = 'error'; this.emit('save', 'error', e); }), 220);
  },
  flush() {
    if (this._flushing) return this._flushing.then(() => this.dirty.size ? this.flush() : undefined);
    if (!this.dirty.size || !this.state) { this.saveState = 'saved'; this.emit('save', 'saved'); return Promise.resolve(); }
    clearTimeout(this._flushTimer);
    const colls = [...this.dirty]; this.dirty.clear();
    this.saveState = 'saving'; this.emit('save', 'saving');
    this._flushing = (async () => {
      const entries = [];
      for (const c of colls) {
        const val = this.state[c];
        entries.push([c, this.meta.encrypted ? await encryptString(this.key, JSON.stringify(val)) : deepClone(val)]);
      }
      this.meta.updated_at = nowISO(); this.meta.last_saved = this.meta.updated_at;
      entries.push(['meta', this.meta]);
      await idbPutMany(this.db, 'kv', entries);
      await this.maybeDailySnapshot();
    })().then(() => { this._flushing = null; this.saveState = this.dirty.size ? 'dirty' : 'saved'; this.emit('save', this.saveState); if (this.dirty.size) this.scheduleFlush(); })
      .catch(e => { this._flushing = null; for (const c of colls) this.dirty.add(c); this.saveState = 'error'; this.emit('save', 'error', e); throw e; });
    return this._flushing;
  },

  /* ---------- transactions with undo ---------- */
  begin(colls) { return { colls, before: Object.fromEntries(colls.map(c => [c, deepClone(this.state[c])])) }; },
  async commit(tx, { label = 'Change', type = 'edit', text = '', silent = false, undoable = true, quiet = false } = {}) {
    const after = Object.fromEntries(tx.colls.map(c => [c, deepClone(this.state[c])]));
    if (undoable) { this.undoStack.push({ label, colls: tx.colls, before: tx.before, after }); if (this.undoStack.length > MAX_UNDO) this.undoStack.shift(); this.redoStack = []; }
    if (!silent) this.log(type, text || label);
    if (tx.colls.some(c => c !== 'activity' && c !== 'settings')) this.index = null;
    this.mark(...tx.colls, 'activity');
    this.emit('change', { colls: tx.colls, label, quiet });
    return this.flush();
  },
  async undo() {
    const u = this.undoStack.pop(); if (!u) return null;
    for (const c of u.colls) this.state[c] = deepClone(u.before[c]);
    this.redoStack.push(u); this.index = null;
    this.log('undo', `Undid: ${u.label}`);
    this.mark(...u.colls, 'activity'); this.emit('change', { colls: u.colls, label: 'undo' });
    await this.flush();
    return u.label;
  },
  async redo() {
    const u = this.redoStack.pop(); if (!u) return null;
    for (const c of u.colls) this.state[c] = deepClone(u.after[c]);
    this.undoStack.push(u); this.index = null;
    this.log('redo', `Redid: ${u.label}`);
    this.mark(...u.colls, 'activity'); this.emit('change', { colls: u.colls, label: 'redo' });
    await this.flush();
    return u.label;
  },
  log(type, text, extra = {}) {
    if (!this.state) return;
    this.state.activity.unshift({ id: uid(), ts: nowISO(), type, text, ...extra });
    if (this.state.activity.length > MAX_ACTIVITY) this.state.activity.length = MAX_ACTIVITY;
  },
  async saveSettings(patch, label = 'Settings changed') {
    const tx = this.begin(['settings']);
    Object.assign(this.state.settings, patch);
    return this.commit(tx, { label, type: 'settings', silent: true, undoable: false });
  },

  /* ---------- index ---------- */
  getIndex() { if (!this.index) this.index = buildIndex(this.state, this.state.settings); return this.index; },

  /* ---------- people ---------- */
  newPerson(fields = {}) {
    const now = nowISO();
    return Object.assign({ id: uid(), company: '', name: '', emails: [], domain: '', status: 'notnow', note: '', tags: [], source: '', first_contact: '', last_contact: '', last_reply: '', revisit_on: '', created_at: now, updated_at: now, history: [] }, fields);
  },
  findPersonByEmail(email) { const n = normEmail(email).email; return n ? this.getIndex().byEmail.get(n) || null : null; },
  findPersonByCompany(company) { const c = cleanCompany(company, this.state.settings.suffixes); return c.length >= 3 ? (this.getIndex().byCompany.get(c) || [])[0] || null : null; },
  /* Add or merge. Returns { person, action: 'added' | 'merged' | 'skipped' }. Caller wraps in begin/commit. */
  upsertPerson(input, { preferExisting = false } = {}) {
    const emails = uniq((input.emails || []).map(e => normEmail(e).email).filter(Boolean));
    let existing = null;
    for (const e of emails) { existing = this.getIndex().byEmail.get(e); if (existing) break; }
    if (!existing && !emails.length && input.company) existing = this.findPersonByCompany(input.company);
    const now = nowISO();
    if (existing) {
      const p = existing;
      const added = emails.filter(e => !p.emails.includes(e));
      p.emails.push(...added);
      if (!preferExisting) {
        if (input.status && input.status !== p.status) { p.history.push({ ts: now, type: 'status', text: `Status ${STATUSES[p.status]?.label || p.status} → ${STATUSES[input.status]?.label || input.status}` }); p.status = input.status; }
        if (input.note && !p.note.includes(input.note)) p.note = p.note ? p.note + '\n' + input.note : input.note;
        for (const k of ['company', 'name', 'revisit_on', 'last_reply', 'last_contact', 'first_contact', 'domain']) if (input[k] && !p[k]) p[k] = input[k];
        if (input.revisit_on) p.revisit_on = input.revisit_on;
      } else {
        for (const k of ['company', 'name', 'note', 'revisit_on']) if (input[k] && !p[k]) p[k] = input[k];
      }
      if (input.tags) p.tags = uniq([...(p.tags || []), ...input.tags]);
      if (added.length) p.history.push({ ts: now, type: 'edit', text: `Added ${added.join(', ')}` });
      if (input.historyNote) p.history.push({ ts: now, type: input.historyType || 'note', text: input.historyNote, campaign: input.campaign || undefined });
      p.updated_at = now;
      this.index = null;
      return { person: p, action: 'merged' };
    }
    const p = this.newPerson({ company: (input.company || '').trim(), name: (input.name || '').trim(), emails, domain: input.domain || '', status: input.status || 'notnow', note: input.note || '', tags: input.tags || [], source: input.source || '', first_contact: input.first_contact || '', last_contact: input.last_contact || '', last_reply: input.last_reply || '', revisit_on: input.revisit_on || '' });
    p.history.push({ ts: now, type: input.historyType || 'add', text: input.historyNote || (input.source ? `Added from ${input.source}` : 'Added'), campaign: input.campaign || undefined });
    this.state.people.unshift(p);
    this.index = null;
    return { person: p, action: 'added' };
  },
  updatePerson(id, patch, historyText) {
    const p = this.state.people.find(x => x.id === id); if (!p) return null;
    const now = nowISO();
    if (patch.status && patch.status !== p.status) p.history.push({ ts: now, type: 'status', text: `Status ${STATUSES[p.status]?.label || p.status} → ${STATUSES[patch.status]?.label || patch.status}` });
    if (patch.emails) patch.emails = uniq(patch.emails.map(e => normEmail(e).email).filter(Boolean));
    Object.assign(p, patch); p.updated_at = now;
    if (historyText) p.history.push({ ts: now, type: 'edit', text: historyText });
    this.index = null;
    return p;
  },
  mergePeople(keepId, dropIds) {
    const keep = this.state.people.find(p => p.id === keepId); if (!keep) return null;
    for (const id of dropIds) {
      const d = this.state.people.find(p => p.id === id); if (!d) continue;
      keep.emails = uniq([...keep.emails, ...d.emails]);
      if (!keep.company) keep.company = d.company; if (!keep.name) keep.name = d.name;
      if (d.note && !keep.note.includes(d.note)) keep.note = keep.note ? keep.note + '\n' + d.note : d.note;
      keep.tags = uniq([...(keep.tags || []), ...(d.tags || [])]);
      keep.status = strongerStatus(keep.status, d.status);
      for (const k of ['first_contact', 'last_contact', 'last_reply', 'revisit_on']) if (!keep[k] && d[k]) keep[k] = d[k];
      keep.history.push(...(d.history || []), { ts: nowISO(), type: 'merge', text: `Merged ${personLabel(d)} into this record` });
      this.state.people = this.state.people.filter(p => p.id !== id);
    }
    keep.history.sort((a, b) => a.ts < b.ts ? -1 : 1);
    keep.updated_at = nowISO(); this.index = null;
    return keep;
  },

  /* ---------- trash ---------- */
  trashRecords(coll, ids) {
    const set = new Set(ids), now = nowISO(), moved = [];
    this.state[coll] = this.state[coll].filter(r => { if (set.has(r.id)) { moved.push(r); return false; } return true; });
    for (const r of moved) this.state.trash.unshift({ id: uid(), coll, record: r, deleted_at: now });
    this.index = null;
    return moved;
  },
  restoreTrash(trashIds) {
    const set = new Set(trashIds), restored = [];
    this.state.trash = this.state.trash.filter(t => {
      if (!set.has(t.id)) return true;
      if (!this.state[t.coll].some(r => r.id === t.record.id)) this.state[t.coll].unshift(t.record);
      restored.push(t); return false;
    });
    this.index = null;
    return restored;
  },
  purgeTrash() {
    const days = this.state.settings.trashDays || 30;
    const cutoff = Date.now() - days * 86400000;
    const before = this.state.trash.length;
    this.state.trash = this.state.trash.filter(t => parseDate(t.deleted_at) > cutoff);
    if (this.state.trash.length !== before) this.mark('trash');
  },

  /* ---------- ledger / bounces / campaigns ---------- */
  rememberSent(emails, { campaignId = '', date = todayISO() } = {}) {
    const map = new Map(this.state.ledger.map(l => [l.email, l]));
    let created = 0, updated = 0;
    for (const raw of emails) {
      const e = normEmail(raw).email; if (!e) continue;
      const l = map.get(e);
      if (l) {
        if (!l.campaigns.includes(campaignId) || !campaignId) { l.count = (l.count || 0) + 1; updated++; }
        if (campaignId && !l.campaigns.includes(campaignId)) l.campaigns.push(campaignId);
        if (!l.first || date < l.first) l.first = date; if (!l.last || date > l.last) l.last = date;
      } else { const n = { id: uid(), email: e, domain: emailDomain(e), first: date, last: date, count: 1, campaigns: campaignId ? [campaignId] : [] }; this.state.ledger.push(n); map.set(e, n); created++; }
    }
    this.index = null;
    return { created, updated };
  },
  addBounces(list, { campaignId = '', date = todayISO(), source = 'paste' } = {}) {
    const map = new Map(this.state.bounces.map(b => [b.email, b]));
    let created = 0, updated = 0;
    for (const item of list) {
      const e = normEmail(item.email).email; if (!e) continue;
      const b = map.get(e);
      if (b) { b.count = (b.count || 1) + 1; if (item.type === 'hard') b.type = 'hard'; if (item.reason && !b.reason) b.reason = item.reason; b.bounced_at = date; if (campaignId) b.campaign_id = b.campaign_id || campaignId; updated++; }
      else { const n = { id: uid(), email: e, domain: emailDomain(e), type: item.type || 'hard', reason: item.reason || '', bounced_at: date, campaign_id: campaignId, source, count: 1 }; this.state.bounces.push(n); map.set(e, n); created++; }
    }
    this.index = null;
    return { created, updated };
  },
  addCampaign(fields) {
    const c = Object.assign({ id: uid(), name: '', date: todayISO(), file: '', rows: 0, ready: 0, ask: 0, block: 0, sent: 0, note: '', created_at: nowISO() }, fields);
    this.state.campaigns.unshift(c);
    return c;
  },
  campaignStats(c) {
    const bounced = this.state.bounces.filter(b => b.campaign_id === c.id).length;
    const replies = this.state.people.filter(p => (p.history || []).some(h => h.campaign === c.id && h.type === 'reply')).length;
    return { bounced, replies, bounceRate: c.sent ? bounced / c.sent : 0, replyRate: c.sent ? replies / c.sent : 0 };
  },

  /* ---------- snapshots ---------- */
  exportObject({ includeActivity = false, includeTrash = false } = {}) {
    const s = this.state;
    const settings = deepClone(s.settings);
    return { app: 'reach', version: 1, exported_at: nowISO(), people: s.people, bounces: s.bounces, ledger: s.ledger, campaigns: s.campaigns, settings, activity: includeActivity ? s.activity : undefined, trash: includeTrash ? s.trash : undefined };
  },
  async snapshot(label = 'manual') {
    const json = JSON.stringify(this.exportObject({ includeActivity: true, includeTrash: true }));
    const rec = { ts: nowISO(), label, bytes: json.length, people: this.state.people.length, bounces: this.state.bounces.length, ledger: this.state.ledger.length, campaigns: this.state.campaigns.length, data: this.meta.encrypted ? await encryptString(this.key, json) : json };
    await idbPutMany(this.db, 'snapshots', [[undefined, rec]]);
    await this.pruneSnapshots();
    this.emit('snapshot');
    return rec;
  },
  async maybeDailySnapshot() {
    const last = this.meta.lastAutoSnapshot || '';
    if (last.slice(0, 10) === todayISO()) return;
    this.meta.lastAutoSnapshot = nowISO();
    await idbPutMany(this.db, 'kv', [['meta', this.meta]]);
    await this.snapshot('daily');
  },
  async listSnapshots() { const all = await idbGetAll(this.db, 'snapshots'); return all.map(({ data, ...r }) => r).sort((a, b) => a.ts < b.ts ? 1 : -1); },
  async pruneSnapshots() {
    const all = (await this.listSnapshots());
    const auto = all.filter(s => s.label === 'daily');
    for (const s of auto.slice(MAX_SNAPSHOTS)) await idbDelete(this.db, 'snapshots', s.ts);
    const manual = all.filter(s => s.label !== 'daily');
    for (const s of manual.slice(MAX_SNAPSHOTS)) await idbDelete(this.db, 'snapshots', s.ts);
  },
  async readSnapshot(ts) {
    const rec = await idbGet(this.db, 'snapshots', ts); if (!rec) throw new Error('Snapshot not found');
    const json = (rec.data && rec.data.enc) ? await decryptString(this.key, rec.data) : rec.data;
    return JSON.parse(json);
  },
  async deleteSnapshot(ts) { await idbDelete(this.db, 'snapshots', ts); this.emit('snapshot'); },
  async replaceAll(obj, { label = 'Restore' } = {}) {
    await this.snapshot('before ' + label);
    const tx = this.begin(COLLECTIONS.filter(c => c !== 'activity'));
    for (const c of ['people', 'bounces', 'ledger', 'campaigns']) this.state[c] = Array.isArray(obj[c]) ? deepClone(obj[c]) : [];
    if (obj.settings) this.state.settings = this.mergeSettings(obj.settings);
    if (Array.isArray(obj.trash)) this.state.trash = deepClone(obj.trash);
    await this.commit(tx, { label, type: 'restore', text: `${label}: ${fmtN(this.state.people.length)} people, ${fmtN(this.state.bounces.length)} bounces, ${fmtN(this.state.ledger.length)} mailed addresses, ${fmtN(this.state.campaigns.length)} campaigns.` });
  },
  async mergeAll(obj, { label = 'Merge backup' } = {}) {
    await this.snapshot('before ' + label);
    const tx = this.begin(['people', 'bounces', 'ledger', 'campaigns']);
    let added = 0, merged = 0;
    for (const p of obj.people || []) { const r = this.upsertPerson({ ...p, historyNote: 'Merged from backup' }, { preferExisting: true }); r.action === 'added' ? added++ : merged++; }
    const have = new Set(this.state.campaigns.map(c => c.id));
    for (const c of obj.campaigns || []) if (!have.has(c.id)) this.state.campaigns.push(deepClone(c));
    const bmap = new Map(this.state.bounces.map(b => [b.email, b]));
    for (const b of obj.bounces || []) if (b.email && !bmap.has(b.email)) { this.state.bounces.push(deepClone(b)); bmap.set(b.email, b); }
    const lmap = new Map(this.state.ledger.map(l => [l.email, l]));
    for (const l of obj.ledger || []) { const x = lmap.get(l.email); if (!x) { this.state.ledger.push(deepClone(l)); lmap.set(l.email, l); } else { x.count = Math.max(x.count, l.count); if (l.first < x.first) x.first = l.first; if (l.last > x.last) x.last = l.last; x.campaigns = uniq([...(x.campaigns || []), ...(l.campaigns || [])]); } }
    await this.commit(tx, { label, type: 'import', text: `${label}: ${added} people added, ${merged} merged.` });
    return { added, merged };
  },

  /* ---------- vault ---------- */
  async setPassphrase(pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pass, salt);
    const check = await encryptString(key, 'reach-ok');
    const snaps = await idbGetAll(this.db, 'snapshots');
    const oldKey = this.key, wasEnc = this.meta.encrypted;
    const entries = [];
    for (const s of snaps) { const json = (s.data && s.data.enc) ? await decryptString(oldKey, s.data) : s.data; entries.push([undefined, { ...s, data: await encryptString(key, json) }]); }
    this.key = key; this.meta = { ...this.meta, encrypted: true, salt: b64enc(salt), check, iterations: PBKDF2_ITERATIONS };
    for (const c of COLLECTIONS) this.dirty.add(c);
    await this.flush();
    if (entries.length) await idbPutMany(this.db, 'snapshots', entries);
    sessionStorage.removeItem('reach.sk');
    this.log('settings', wasEnc ? 'Vault passphrase changed.' : 'Vault lock turned on: everything on this device is now encrypted.');
    this.mark('activity'); await this.flush();
    this.emit('vault');
  },
  async removePassphrase() {
    const snaps = await idbGetAll(this.db, 'snapshots');
    const entries = [];
    for (const s of snaps) if (s.data && s.data.enc) entries.push([undefined, { ...s, data: await decryptString(this.key, s.data) }]);
    this.meta = { ...this.meta, encrypted: false, salt: '', check: null };
    this.key = null;
    for (const c of COLLECTIONS) this.dirty.add(c);
    await this.flush();
    if (entries.length) await idbPutMany(this.db, 'snapshots', entries);
    sessionStorage.removeItem('reach.sk');
    this.log('settings', 'Vault lock turned off: data is stored unencrypted on this device.');
    this.mark('activity'); await this.flush();
    this.emit('vault');
  },
  async wipeEverything() {
    await idbClear(this.db, 'kv'); await idbClear(this.db, 'snapshots');
    sessionStorage.removeItem('reach.sk'); localStorage.removeItem('reach.ui');
  },
  async storageEstimate() { try { return await navigator.storage.estimate(); } catch (e) { return null; } },
};

window.addEventListener('pagehide', () => { if (Store.dirty.size) Store.flush().catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && Store.dirty.size) Store.flush().catch(() => {}); });
