/* =============================================================================
   Reach — optional cloud backup (Supabase)
   Off by default. When on, the whole memory is encrypted on this device with
   your backup passphrase and appended as one row to a Supabase table through
   its REST API. Supabase only ever sees ciphertext. The table is append-only
   for the public key (see supabase/reach_backups.sql), so a leaked key can
   add junk rows but never read, change or delete your backups.
   ============================================================================= */
'use strict';

const Cloud = {
  _timer: null,
  cfg() { return Store.state.settings.cloud; },
  ready() { const c = this.cfg(); return !!(c.enabled && /^https?:\/\/\S+$/.test(c.url || '') && (c.key || '').length > 20 && (c.pass || '').length >= 8); },
  headers() { const c = this.cfg(); return { 'apikey': c.key, 'Authorization': `Bearer ${c.key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }; },
  endpoint(path = '') { const c = this.cfg(); return `${c.url.replace(/\/+$/, '')}/rest/v1/${c.table || 'reach_backups'}${path}`; },
  async encryptPayload(json) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(this.cfg().pass, salt);
    const blob = await encryptString(key, json);
    return { v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: b64enc(salt), iv: b64enc(blob.iv), ct: b64enc(blob.ct) };
  },
  async decryptPayload(payload, pass = this.cfg().pass) {
    const key = await deriveKey(pass, b64dec(payload.salt), payload.iterations || PBKDF2_ITERATIONS);
    return JSON.parse(await decryptString(key, { iv: payload.iv, ct: payload.ct }));
  },
  async backup(label = 'manual') {
    if (!this.ready()) throw new Error('Cloud backup is not set up: fill in the URL, key and a backup passphrase in Settings.');
    const json = JSON.stringify(Store.exportObject({ includeActivity: false, includeTrash: false }));
    const payload = await this.encryptPayload(json);
    const body = { device: this.deviceName(), label, bytes: json.length, people: Store.state.people.length, bounces: Store.state.bounces.length, ledger: Store.state.ledger.length, payload };
    const r = await fetch(this.endpoint(), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await this.errorText(r));
    const row = (await r.json())[0] || {};
    await Store.saveSettings({ cloud: { ...this.cfg(), lastBackup: nowISO(), lastBackupId: row.id || '' } });
    Store.log('cloud', `Backed up to the cloud (${bytesFmt(json.length)}, encrypted).`); Store.mark('activity');
    return row;
  },
  async list(limit = 20) {
    if (!this.ready()) throw new Error('Cloud backup is not set up.');
    const r = await fetch(this.endpoint(`?select=id,created_at,device,label,bytes,people,bounces,ledger&order=created_at.desc&limit=${limit}`), { headers: this.headers() });
    if (!r.ok) throw new Error(await this.errorText(r));
    return r.json();
  },
  async fetchOne(id) {
    const r = await fetch(this.endpoint(`?select=id,created_at,payload&id=eq.${encodeURIComponent(id)}`), { headers: this.headers() });
    if (!r.ok) throw new Error(await this.errorText(r));
    const rows = await r.json(); if (!rows.length) throw new Error('Backup not found');
    return rows[0];
  },
  async restore(id, { mode = 'replace', pass } = {}) {
    const row = await this.fetchOne(id);
    const obj = await this.decryptPayload(row.payload, pass);
    if (obj.app !== 'reach') throw new Error('That backup is not a Reach backup.');
    if (mode === 'merge') return Store.mergeAll(obj, { label: 'Merge cloud backup' });
    return Store.replaceAll(obj, { label: 'Restore cloud backup' });
  },
  async test() {
    const c = this.cfg();
    if (!/^https?:\/\/\S+$/.test(c.url || '') || (c.key || '').length < 20) throw new Error('Enter the project URL and the publishable (anon) key first.');
    const r = await fetch(this.endpoint('?select=id&limit=1'), { headers: this.headers() });
    if (r.status === 404 || r.status === 406) throw new Error('Table not found. Run supabase/reach_backups.sql in the Supabase SQL editor first.');
    if (!r.ok) throw new Error(await this.errorText(r));
    return true;
  },
  async errorText(r) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); if (j.message) msg = j.message; if (j.hint) msg += ` (${j.hint})`; } catch (e) { /* ignore */ }
    if (r.status === 0 || r.status === 503 || /paused|not reachable/i.test(msg)) msg += ' — is the Supabase project paused? Open the dashboard and resume it.';
    return msg;
  },
  deviceName() { const ua = navigator.userAgent; const os = /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : 'Device'; const br = /Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Safari/.test(ua) && !/Chrome/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : 'Browser'; return `${os} · ${br}`; },
  scheduleAuto() {
    if (!Store.state || !this.ready() || !this.cfg().auto) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.backup('auto').then(() => Store.emit('cloud', 'ok')).catch(e => { console.warn('auto backup failed', e); Store.emit('cloud', 'error', e); }), 45000);
  },
};
Store.on((type, d) => { if (type === 'change' && d && d.colls && d.colls.some(c => c !== 'activity' && c !== 'settings')) Cloud.scheduleAuto(); });
