/* =============================================================================
   Reach — Settings: rules, lists, privacy (vault), backups (local, snapshots,
   cloud), danger zone, about.
   ============================================================================= */
'use strict';

async function encryptWithPass(json, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass, salt); const blob = await encryptString(key, json);
  return { app: 'reach', encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: b64enc(salt), iv: b64enc(blob.iv), ct: b64enc(blob.ct) };
}
async function decryptWithPass(obj, pass) {
  const key = await deriveKey(pass, b64dec(obj.salt), obj.iterations || PBKDF2_ITERATIONS);
  return JSON.parse(await decryptString(key, { iv: obj.iv, ct: obj.ct }));
}

const SettingsView = {
  tabs: [['general', 'General', 'settings'], ['rules', 'Rules', 'shield'], ['lists', 'Lists', 'list'], ['privacy', 'Privacy', 'lock'], ['backups', 'Backups', 'db'], ['about', 'About', 'info']],
  render(root, sub) {
    const tab = this.tabs.some(t => t[0] === sub) ? sub : 'general';
    root.innerHTML = pageHead({ eyebrow: 'Reach', title: 'Settings', lede: 'How Reach screens, what it remembers, and where your data lives.' }) + `<div class="tabs">${this.tabs.map(([k, l, ic]) => `<button class="${tab === k ? 'active' : ''}" data-tab="${k}">${icon(ic, 'ic-sm')}${l}</button>`).join('')}</div><div id="set-body" style="max-width:860px"></div>`;
    $$('[data-tab]', root).forEach(b => b.onclick = () => App.go('settings', b.dataset.tab));
    this['render_' + tab]($('#set-body', root));
  },
  save(patch, msg = 'Saved') { return Store.saveSettings(patch).then(() => toast(msg, 'ok', { timeout: 1400 })); },

  /* ---------- General ---------- */
  render_general(body) {
    const st = Store.state.settings;
    body.innerHTML = `<div class="stack">
      <div class="card card-pad"><div class="form-grid">
        <div class="field"><label>Your name</label><input class="input" id="g-name" value="${esc(st.name)}"><div class="hint">Used in the screening summary (“Pratim, you already know…”).</div></div>
        <div class="field"><label>Theme</label><div class="seg"><button data-theme="light" class="${st.theme === 'light' ? 'active' : ''}">Light</button><button data-theme="dark" class="${st.theme === 'dark' ? 'active' : ''}">Dark</button><button data-theme="auto" class="${st.theme === 'auto' ? 'active' : ''}">System</button></div></div>
        <div class="field"><label>Download format</label><div class="seg"><button data-fmt="xlsx" class="${st.exportFormat === 'xlsx' ? 'active' : ''}">.xlsx</button><button data-fmt="csv" class="${st.exportFormat === 'csv' ? 'active' : ''}">.csv</button></div><div class="hint">For clean lists, exports and backups of sheets.</div></div>
        <div class="field"><label>Keep deleted items for</label><div class="row"><input class="input sm" type="number" min="1" max="365" id="g-trash" value="${st.trashDays}" style="width:90px"><span class="small muted">days in the trash</span></div></div>
      </div></div>
      <div class="card card-pad"><h3 style="font-size:.95rem">Google Sheets</h3><div class="small muted mt-1">Reach does not connect to your Google account (that would need its own login and permissions). Two ways that work with nothing to set up:</div>
        <div class="steps mt-2"><div class="step"><div><b>Download as CSV</b><span>File → Download → Comma-separated values, then drop the file on Screen a list.</span></div></div><div class="step"><div><b>Copy &amp; paste</b><span>Select the cells including the header row, copy, and paste into the paste box. Reach reads the tab-separated cells directly.</span></div></div></div></div></div>`;
    $('#g-name', body).onchange = e => this.save({ name: e.target.value.trim() || 'there' });
    $$('[data-theme]', body).forEach(b => b.onclick = () => { App.setTheme(b.dataset.theme); $$('[data-theme]', body).forEach(x => x.classList.toggle('active', x === b)); });
    $$('[data-fmt]', body).forEach(b => b.onclick = () => { this.save({ exportFormat: b.dataset.fmt }); $$('[data-fmt]', body).forEach(x => x.classList.toggle('active', x === b)); });
    $('#g-trash', body).onchange = e => this.save({ trashDays: clamp(+e.target.value || 30, 1, 365) });
  },

  /* ---------- Rules ---------- */
  render_rules(body) {
    const r = Store.state.settings.rules;
    const sel = (path, val, opts = [['block', 'Block'], ['ask', 'Your call'], ['allow', 'Allow']]) => `<select class="select sm" data-rule="${path}">${opts.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    body.innerHTML = `<div class="stack">
      <div class="callout">${icon('info')}<div><b>Block</b> leaves the row out of the clean list (you can still override one by one). <b>Your call</b> leaves it out unless you tick it. <b>Allow</b> keeps it in and just shows a note. The strongest rule that applies wins.</div></div>
      <div class="card card-pad"><h3 style="font-size:.95rem">When a row matches someone in memory</h3>
        <div class="rule-grid mt-3"><div></div><div class="rh">Exact email</div><div class="rh">Same domain</div><div class="rh">Same company</div>
        ${STATUS_KEYS.map(k => `<div>${statusChip(k, { sm: true })}<div class="tiny muted">${esc(STATUSES[k].desc)}</div></div><div>${sel('status.' + k, r.status[k])}</div><div>${sel('domain.' + k, r.domain[k])}</div><div>${sel('company.' + k, r.company[k])}</div>`).join('')}
        </div>
        <div class="hint mt-2">Same domain only counts for company domains, never gmail/yahoo/outlook (see Lists). Same company compares cleaned names: “Druk Asia Tours Pvt Ltd” = “Druk Asia”.</div>
        <div class="form-grid mt-3">
          <div class="field"><label>Not now after its revisit date has passed</label>${sel('notnowAfterRevisit', r.notnowAfterRevisit)}</div>
          <div class="field"><label>Same full contact name (2+ words), different company</label>${sel('name', r.name)}</div>
        </div></div>
      <div class="card card-pad"><h3 style="font-size:.95rem">Bounces and sends</h3><div class="form-grid mt-3">
        <div class="field"><label>Hard bounce</label>${sel('bounceHard', r.bounceHard)}</div>
        <div class="field"><label>Soft bounce</label>${sel('bounceSoft', r.bounceSoft)}</div>
        <div class="field"><label>Mailed before, within the cooldown</label>${sel('mailed', r.mailed)}</div>
        <div class="field"><label>Cooldown</label><div class="row"><input class="input sm" type="number" min="0" max="3650" data-rule-num="mailedCooldownDays" value="${r.mailedCooldownDays}" style="width:90px"><span class="small muted">days since the last send</span></div></div>
        <div class="field"><label>Mailed before, after the cooldown</label>${sel('mailedAfterCooldown', r.mailedAfterCooldown)}</div>
      </div></div>
      <div class="card card-pad"><h3 style="font-size:.95rem">Address hygiene</h3><div class="form-grid mt-3">
        <div class="field"><label>Role mailboxes (info@, sales@, hello@…)</label>${sel('role', r.role)}</div>
        <div class="field"><label>Free mailboxes (gmail, yahoo…)</label>${sel('freemail', r.freemail, [['info', 'Just a note'], ['ask', 'Your call'], ['block', 'Block']])}</div>
      </div></div>
      <div class="row"><button class="btn btn-quiet btn-sm" data-reset-rules>${icon('undo', 'ic-sm')}Reset rules to defaults</button></div></div>`;
    $$('[data-rule]', body).forEach(s => s.onchange = () => { const rules = deepClone(Store.state.settings.rules); const [a, b] = s.dataset.rule.split('.'); if (b) rules[a][b] = s.value; else rules[a] = s.value; this.save({ rules }, 'Rules saved'); });
    $$('[data-rule-num]', body).forEach(i => i.onchange = () => { const rules = deepClone(Store.state.settings.rules); rules[i.dataset.ruleNum] = clamp(+i.value || 0, 0, 3650); this.save({ rules }, 'Rules saved'); });
    $('[data-reset-rules]', body).onclick = async () => { if (await uiConfirm({ title: 'Reset the rules?', confirmLabel: 'Reset' })) { await this.save({ rules: defaultRules() }, 'Rules reset'); this.render_rules(body); } };
  },

  /* ---------- Lists ---------- */
  render_lists(body) {
    const st = Store.state.settings;
    const box = (key, title, hint, defaults) => `<div class="card card-pad"><div class="row between"><h3 style="font-size:.95rem">${title}</h3><button class="btn btn-quiet btn-xs" data-reset="${key}">Reset</button></div><div class="small muted mt-1 mb-2">${hint}</div><div class="list-chip-input" data-list="${key}">${st[key].map(v => tagHtml(v, true)).join('')}<input placeholder="add, press Enter"></div></div>`;
    body.innerHTML = `<div class="stack">
      ${box('freeDomains', 'Free mailbox domains', 'Addresses at these domains never count as a company domain, so one gmail client does not block every gmail address.', FREE_EMAIL_DOMAINS_DEFAULT)}
      ${box('roleLocals', 'Role mailboxes', 'The part before the @ that means “a shared inbox, not a person”.', ROLE_LOCALS_DEFAULT)}
      ${box('suffixes', 'Company name suffixes', 'Stripped from the end of company names before comparing, so “Blue Poppy Bhutan Tours Pvt Ltd” matches “Blue Poppy Bhutan”.', COMPANY_SUFFIXES_DEFAULT)}</div>`;
    const defaults = { freeDomains: FREE_EMAIL_DOMAINS_DEFAULT, roleLocals: ROLE_LOCALS_DEFAULT, suffixes: COMPANY_SUFFIXES_DEFAULT };
    $$('[data-list]', body).forEach(el => {
      const key = el.dataset.list, inp = $('input', el);
      const commit = list => this.save({ [key]: list }, 'List saved').then(() => { Store.index = null; });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const v = inp.value.trim().toLowerCase().replace(/,$/, ''); if (!v) return; const list = uniq([...Store.state.settings[key], v]); inp.value = ''; inp.insertAdjacentHTML('beforebegin', tagHtml(v, true)); commit(list); } });
      el.addEventListener('click', e => { const rm = e.target.closest('[data-rm-tag]'); if (!rm) return; const v = rm.dataset.rmTag; rm.closest('.tag').remove(); commit(Store.state.settings[key].filter(x => x !== v)); });
    });
    $$('[data-reset]', body).forEach(b => b.onclick = async () => { const key = b.dataset.reset; await this.save({ [key]: defaults[key].slice() }, 'Reset'); Store.index = null; this.render_lists(body); });
  },

  /* ---------- Privacy ---------- */
  async render_privacy(body) {
    const enc = Store.meta.encrypted, st = Store.state.settings;
    const est = await Store.storageEstimate();
    body.innerHTML = `<div class="stack">
      <div class="card card-pad"><div class="row between wrap"><div><h3 style="font-size:1rem">${icon(enc ? 'lock' : 'unlock', 'ic-sm')} Vault lock is ${enc ? 'on' : 'off'}</h3><div class="small muted mt-1">${enc ? 'Everything in this browser is encrypted with AES-256-GCM. The key is derived from your passphrase (PBKDF2, 310,000 rounds) and never stored on disk.' : 'Your memory is stored unencrypted in this browser’s database. Anyone who can open this browser profile can read it. Turn the vault on to encrypt it at rest.'}</div></div>
        <div class="row">${enc ? `<button class="btn btn-ghost btn-sm" data-change>Change passphrase</button><button class="btn btn-danger-ghost btn-sm" data-off>Turn off</button>` : `<button class="btn btn-primary" data-on>${icon('lock')}Turn on the vault</button>`}</div></div>
        ${enc ? `<div class="sep"></div><div class="form-grid"><div class="field"><label>Auto-lock after</label><div class="row"><input class="input sm" type="number" min="0" max="720" id="p-idle" value="${st.lock.autoLockMinutes}" style="width:90px"><span class="small muted">minutes idle (0 = never)</span></div></div><div class="field"><label>&nbsp;</label><button class="btn btn-ghost btn-sm" data-lock-now>${icon('lock', 'ic-sm')}Lock now</button></div></div>` : ''}
        <div class="callout warn mt-3 small">${icon('alert')}<div><b>There is no “forgot passphrase”.</b> Without it the encrypted data cannot be read by anyone, including you. Keep a backup (Settings → Backups) somewhere safe.</div></div></div>
      <div class="card card-pad"><h3 style="font-size:.95rem">Where your data lives</h3><dl class="kv mt-2">
        <dt>This device</dt><dd>IndexedDB of this browser profile, origin <code>${esc(location.origin === 'null' ? 'file://' : location.origin)}</code>${est && est.usage ? ` · ${bytesFmt(est.usage)} used` : ''}. Snapshots live there too.</dd>
        <dt>Network</dt><dd>Nothing is sent anywhere unless you turn on cloud backup. Fonts load from Google Fonts; the spreadsheet library is bundled.</dd>
        <dt>Screened lists</dt><dd>Read in memory, never stored. Only the bare addresses are kept when you press “I sent this list”.</dd>
        <dt>Cloud backup</dt><dd>${st.cloud.enabled ? 'On. Encrypted on this device before upload; Supabase only stores ciphertext.' : 'Off.'}</dd>
        <dt>Clearing</dt><dd>Clearing site data in the browser, or Settings → Backups → Delete everything, removes it all.</dd></dl></div></div>`;
    const on = $('[data-on]', body); if (on) on.onclick = () => this.passModal({ mode: 'set', after: () => this.render_privacy(body) });
    const ch = $('[data-change]', body); if (ch) ch.onclick = () => this.passModal({ mode: 'change', after: () => this.render_privacy(body) });
    const off = $('[data-off]', body); if (off) off.onclick = () => this.passModal({ mode: 'remove', after: () => this.render_privacy(body) });
    const idle = $('#p-idle', body); if (idle) idle.onchange = e => { this.save({ lock: { ...st.lock, autoLockMinutes: clamp(+e.target.value || 0, 0, 720) } }); App.touchIdle(); };
    const ln = $('[data-lock-now]', body); if (ln) ln.onclick = () => Store.lock();
  },
  passModal({ mode, after }) {
    const titles = { set: 'Turn on the vault', change: 'Change passphrase', remove: 'Turn off the vault' };
    const m = openModal({ title: titles[mode], size: 'sm', body: `
      ${mode !== 'set' ? `<div class="field"><label>Current passphrase</label><input class="input" type="password" id="pp-cur" autocomplete="current-password" autofocus></div>` : ''}
      ${mode !== 'remove' ? `<div class="field mt-2"><label>${mode === 'change' ? 'New passphrase' : 'Passphrase'}</label><input class="input" type="password" id="pp-new" autocomplete="new-password" ${mode === 'set' ? 'autofocus' : ''}><div class="hint" id="pp-str">At least 8 characters. A sentence you will remember beats a short clever one.</div></div><div class="field mt-2"><label>Repeat it</label><input class="input" type="password" id="pp-rep" autocomplete="new-password"></div>` : '<div class="small" style="color:var(--text-2)">Your data will be stored unencrypted on this device again.</div>'}
      ${mode === 'set' ? '<div class="callout warn mt-3 small">' + icon('alert') + '<div>If you forget it, nothing can recover the data. Download a backup first if you have not.</div></div>' : ''}`,
      foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn ${mode === 'remove' ? 'btn-danger' : 'btn-primary'}" data-ok>${mode === 'remove' ? 'Turn off' : 'Encrypt'}</button>` });
    $('[data-cancel]', m).onclick = () => closeModal(m);
    const nw = $('#pp-new', m); if (nw) nw.addEventListener('input', () => { const v = nw.value; const s = v.length >= 16 ? 'Strong.' : v.length >= 12 ? 'Good.' : v.length >= 8 ? 'Okay — longer is better.' : 'Too short.'; $('#pp-str', m).textContent = s; });
    $('[data-ok]', m).onclick = async () => {
      const btn = $('[data-ok]', m);
      try {
        if (mode !== 'set') { const cur = $('#pp-cur', m).value; const key = await deriveKey(cur, b64dec(Store.meta.salt), Store.meta.iterations || PBKDF2_ITERATIONS); if (!(await Store.verifyKey(key))) { $('#pp-cur', m).classList.add('invalid'); return toast('That is not the current passphrase.', 'warn'); } }
        if (mode !== 'remove') { const a = nw.value, b = $('#pp-rep', m).value; if (a.length < 8) return toast('Use at least 8 characters.', 'warn'); if (a !== b) { $('#pp-rep', m).classList.add('invalid'); return toast('The two passphrases do not match.', 'warn'); } }
        btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Working';
        if (mode === 'remove') await Store.removePassphrase(); else await Store.setPassphrase(nw.value);
        closeModal(m); toast(mode === 'remove' ? 'Vault turned off.' : mode === 'change' ? 'Passphrase changed.' : 'Vault on. Everything is encrypted on this device.'); App.renderSide(); App.touchIdle(); after && after();
      } catch (e) { toastErr(e); btn.disabled = false; btn.textContent = mode === 'remove' ? 'Turn off' : 'Encrypt'; }
    };
  },

  /* ---------- Backups ---------- */
  async render_backups(body) {
    const st = Store.state.settings, c = st.cloud, oi = st.oldReachImport;
    const snaps = await Store.listSnapshots();
    body.innerHTML = `<div class="stack">
      <div class="card card-pad"><h3 style="font-size:.95rem">Backup file</h3><div class="small muted mt-1">One .json with everything: people, bounces, mailed addresses, campaigns and settings. Keep it in your own Drive or Dropbox.</div>
        <div class="row mt-3 wrap"><button class="btn btn-primary btn-sm" data-dl>${icon('download', 'ic-sm')}Download backup</button><label class="btn btn-ghost btn-sm">${icon('upload', 'ic-sm')}Restore from file<input type="file" accept=".json,application/json" hidden id="bk-file"></label><button class="btn btn-ghost btn-sm" data-sheets>${icon('sheet', 'ic-sm')}All sheets as .xlsx</button></div></div>
      <div class="card"><div class="card-head"><h3>Snapshots on this device</h3><button class="btn btn-ghost btn-sm" data-snap>${icon('history', 'ic-sm')}Take one now</button></div><div class="card-pad" style="padding-top:.4rem"><div class="small muted mb-2">Reach keeps a snapshot of everything the first time it saves each day, plus one before every restore or import. The last ${MAX_SNAPSHOTS} of each kind are kept.</div>
        ${snaps.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Kind</th><th>Contents</th><th></th></tr></thead><tbody>${snaps.map(s => `<tr><td class="nowrap">${fmtDateTime(s.ts)}</td><td><span class="pill">${esc(s.label)}</span></td><td class="small muted">${fmtN(s.people)} people · ${fmtN(s.bounces)} bounces · ${fmtN(s.ledger)} mailed · ${bytesFmt(s.bytes)}</td><td class="right nowrap"><button class="btn btn-ghost btn-xs" data-restore-snap="${s.ts}">Restore</button> <button class="btn btn-quiet btn-xs" data-del-snap="${s.ts}">${icon('x', 'ic-sm')}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">No snapshots yet.</div>'}</div></div>
      <div class="card card-pad"><div class="row between wrap"><div><h3 style="font-size:.95rem">${icon('cloud', 'ic-sm')} Cloud backup (Supabase)</h3><div class="small muted mt-1">Optional. The whole memory is encrypted on this device with the backup passphrase, then appended as one row to your Supabase project. Supabase never sees plain text. Restore it on any device with the same passphrase.</div></div><label class="toggle"><input type="checkbox" id="cl-on" ${c.enabled ? 'checked' : ''}><span class="tg"></span><span>${c.enabled ? 'On' : 'Off'}</span></label></div>
        <div id="cl-body" ${c.enabled ? '' : 'hidden'}><div class="sep"></div>
          <div class="steps mb-3"><div class="step"><div><b>Resume the project</b><span>Supabase pauses free projects after a week of inactivity. Open the dashboard and press Restore.</span></div></div><div class="step"><div><b>Create the table once</b><span>SQL Editor → paste <code>supabase/reach_backups.sql</code> → Run. It is append-only for the app key.</span></div></div><div class="step"><div><b>Fill in the three fields below</b><span>Project URL and publishable key are in Project Settings → API. The passphrase is yours; Reach only stores it on this device.</span></div></div></div>
          <div class="form-grid">
            <div class="field full"><label>Project URL</label><input class="input sm" id="cl-url" value="${esc(c.url)}" placeholder="https://xxxx.supabase.co"></div>
            <div class="field full"><label>Publishable (anon) key</label><input class="input sm" id="cl-key" value="${esc(c.key)}" placeholder="sb_publishable_…"></div>
            <div class="field"><label>Backup passphrase</label><input class="input sm" type="password" id="cl-pass" value="${esc(c.pass)}" autocomplete="off"><div class="hint">8+ characters. Needed to restore. Can be the same as the vault passphrase.</div></div>
            <div class="field"><label>Table</label><input class="input sm" id="cl-table" value="${esc(c.table || 'reach_backups')}"></div>
            <div class="field full"><label class="toggle"><input type="checkbox" id="cl-auto" ${c.auto ? 'checked' : ''}><span class="tg"></span><span>Back up automatically about a minute after every change</span></label></div>
          </div>
          <div class="row mt-3 wrap"><button class="btn btn-ghost btn-sm" data-test>${icon('zap', 'ic-sm')}Test connection</button><button class="btn btn-primary btn-sm" data-backup>${icon('cloud', 'ic-sm')}Back up now</button><button class="btn btn-ghost btn-sm" data-cloud-list>${icon('download', 'ic-sm')}Restore from cloud</button><span class="small muted">${c.lastBackup ? `Last backup ${relTime(c.lastBackup)}` : 'Never backed up'}</span></div></div></div>
      <div class="card card-pad"><h3 style="font-size:.95rem">${icon('db', 'ic-sm')} Import from the old Reach (Supabase)</h3><div class="small muted mt-1">One time. Reads the old <code>never_mail</code>, <code>bounce_suppression</code> and <code>sent_ledger</code> tables from the project and folds them into the memory on this device. People already here are merged, not duplicated. Nothing is written to Supabase.${oi ? ` Last run ${relTime(oi.at)}: ${fmtN(oi.people)} people, ${fmtN(oi.bounces)} bounced and ${fmtN(oi.ledger)} mailed addresses.` : ''}</div>
        <div class="steps mt-3 mb-3"><div class="step"><div><b>Resume the project</b><span>Free projects pause after a week idle. Open the Supabase dashboard and press Restore.</span></div></div><div class="step"><div><b>Only if the old tables are locked down</b><span>SQL Editor → paste <code>supabase/old_tables_read.sql</code> → Run. It lets the publishable key read the three old tables, and nothing else.</span></div></div><div class="step"><div><b>Preview, then import</b><span>Client → Client, Replied → Warm, Do not contact → Do not contact. Bounces arrive as hard bounces with their dates; mailed addresses keep their first/last dates and counts. A snapshot is taken first and the whole import is one undo.</span></div></div></div>
        <div class="row wrap"><button class="btn btn-primary btn-sm" data-old-import>${icon('cloud', 'ic-sm')}Read the old tables</button><span class="small muted">Prefer CSV? Export each table from the Supabase table editor; the README says which Reach screen takes it.</span></div></div>
      <div class="card card-pad" style="border-color:color-mix(in srgb,var(--red) 35%,transparent)"><h3 style="font-size:.95rem;color:var(--red)">Danger zone</h3><div class="row mt-2 wrap"><button class="btn btn-danger-ghost btn-sm" data-wipe>${icon('trash', 'ic-sm')}Delete everything on this device</button><span class="small muted">Removes the memory, snapshots and settings from this browser. Backups you downloaded or sent to the cloud are untouched.</span></div></div></div>`;
    $('[data-dl]', body).onclick = () => this.downloadBackup();
    $('#bk-file', body).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.restoreFile(f); };
    $('[data-sheets]', body).onclick = () => this.exportAllSheets();
    $('[data-snap]', body).onclick = async () => { await Store.snapshot('manual'); toast('Snapshot taken.'); this.render_backups(body); };
    $$('[data-restore-snap]', body).forEach(b => b.onclick = () => this.restoreSnapshot(b.dataset.restoreSnap, body));
    $$('[data-del-snap]', body).forEach(b => b.onclick = async () => { await Store.deleteSnapshot(b.dataset.delSnap); this.render_backups(body); });
    const cloudPatch = () => ({ cloud: { ...Store.state.settings.cloud, enabled: $('#cl-on', body).checked, url: $('#cl-url', body).value.trim(), key: $('#cl-key', body).value.trim(), pass: $('#cl-pass', body).value, table: $('#cl-table', body).value.trim() || 'reach_backups', auto: $('#cl-auto', body).checked } });
    $('#cl-on', body).onchange = async () => { $('#cl-body', body).hidden = !$('#cl-on', body).checked; $('#cl-on', body).nextElementSibling.nextElementSibling.textContent = $('#cl-on', body).checked ? 'On' : 'Off'; await this.save(cloudPatch(), $('#cl-on', body).checked ? 'Cloud backup on' : 'Cloud backup off'); App.renderSide(); };
    ['cl-url', 'cl-key', 'cl-pass', 'cl-table', 'cl-auto'].forEach(id => $('#' + id, body).onchange = () => this.save(cloudPatch()));
    $('[data-test]', body).onclick = async e => { const b = e.currentTarget; b.disabled = true; try { await this.save(cloudPatch(), 'Saved'); await Cloud.test(); toast('Connected. The table is reachable.'); } catch (err) { toastErr(err); } b.disabled = false; };
    $('[data-backup]', body).onclick = async e => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Backing up'; try { await this.save(cloudPatch(), 'Saved'); await Cloud.backup('manual'); toast('Backed up to the cloud (encrypted).'); this.render_backups(body); } catch (err) { toastErr(err); b.disabled = false; b.innerHTML = icon('cloud', 'ic-sm') + 'Back up now'; } };
    $('[data-cloud-list]', body).onclick = async () => { try { await this.save(cloudPatch(), 'Saved'); this.cloudRestoreModal(); } catch (err) { toastErr(err); } };
    $('[data-old-import]', body).onclick = () => this.oldReachModal(body);
    $('[data-wipe]', body).onclick = async () => { if (!(await uiConfirm({ title: 'Delete everything on this device?', message: 'People, bounces, mailed addresses, campaigns, snapshots and settings are removed from this browser. Download a backup first unless you are sure.', confirmLabel: 'Delete everything', danger: true, typed: 'DELETE' }))) return; await Store.wipeEverything(); location.reload(); };
  },
  /* ---------- Import from the old Reach (Supabase) ---------- */
  oldReachModal(body) {
    const c = Store.state.settings.cloud;
    const m = openModal({ title: 'Import from the old Reach', size: 'lg', sub: 'Reads the three old tables, shows what would change, and writes only when you confirm. Nothing is sent to Supabase.',
      body: `<div class="form-grid"><div class="field full"><label>Old project URL</label><input class="input sm" id="om-url" value="${esc(c.url)}" placeholder="https://xxxx.supabase.co"></div><div class="field full"><label>Publishable (anon) key</label><input class="input sm" id="om-key" value="${esc(c.key)}" placeholder="sb_publishable_…" autocomplete="off"></div></div>
        <div id="om-status" class="small muted mt-2"></div><div id="om-preview" class="mt-3"></div>`,
      foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-ghost" data-read>${icon('cloud', 'ic-sm')}Read the old tables</button><button class="btn btn-primary" data-import hidden>Import</button>` });
    const status = $('#om-status', m), prev = $('#om-preview', m), readBtn = $('[data-read]', m), impBtn = $('[data-import]', m);
    let plan = null;
    $('[data-cancel]', m).onclick = () => closeModal(m);
    readBtn.onclick = async () => {
      const url = $('#om-url', m).value.trim(), key = $('#om-key', m).value.trim();
      try { OldReach.checkConfig({ url, key }); } catch (e) { return toast(e.message, 'warn'); }
      readBtn.disabled = true; readBtn.innerHTML = '<span class="spin"></span> Reading'; impBtn.hidden = true; prev.innerHTML = ''; plan = null;
      try {
        const cc = Store.state.settings.cloud;
        if (url !== cc.url || key !== cc.key) await Store.saveSettings({ cloud: { ...cc, url, key } });
        const data = await OldReach.fetchAll({ url, key }, (t, n) => { status.textContent = `Reading ${t}… ${fmtN(n)} rows`; });
        plan = OldReach.plan(data, OldReach.storeLookup());
        status.textContent = `Read ${fmtN(plan.people.total)} never_mail, ${fmtN(plan.bounces.total)} bounce_suppression and ${fmtN(plan.ledger.total)} sent_ledger rows.`;
        prev.innerHTML = this.oldReachPreviewHtml(plan);
        $$('[data-open-person]', prev).forEach(b => b.onclick = () => PeopleUI.open(b.dataset.openPerson));
        impBtn.hidden = !plan.writes; impBtn.textContent = `Import ${fmtN(plan.writes)}`;
        if (!plan.writes) status.textContent += ' Nothing to import.';
        readBtn.innerHTML = icon('repeat', 'ic-sm') + 'Read again';
      } catch (e) { status.textContent = ''; toastErr(e); readBtn.innerHTML = icon('cloud', 'ic-sm') + 'Read the old tables'; }
      readBtn.disabled = false;
    };
    impBtn.onclick = async () => {
      if (!plan || !plan.writes) return;
      impBtn.disabled = true; readBtn.disabled = true; impBtn.innerHTML = '<span class="spin"></span> Importing';
      const p = startProgress().step('Importing from the old Reach', 'Snapshot first, then people, bounces and mailed addresses.', plan.writes);
      try {
        const r = await OldReach.apply(plan, { onProgress: n => p.set(n) });
        p.close(); closeModal(m);
        toast(`Imported from the old Reach: ${r.people.added} people added, ${r.people.merged} merged · ${r.bounces.created} bounced · ${r.ledger.created} mailed addresses.`, 'ok', { timeout: 9000, action: { label: 'Undo', fn: () => App.undo() } });
        this.render_backups(body);
      } catch (e) { p.close(); toastErr(e, 'Import failed; nothing was changed.'); impBtn.disabled = false; readBtn.disabled = false; impBtn.textContent = `Import ${fmtN(plan.writes)}`; }
    };
  },
  oldReachPreviewHtml(plan) {
    const P = plan.people, B = plan.bounces, L = plan.ledger;
    const chips = Object.entries(P.byStatus).sort((a, b) => (STATUSES[a[0]]?.order ?? 9) - (STATUSES[b[0]]?.order ?? 9)).map(([k, n]) => `${statusChip(k, { sm: true })} ${fmtN(n)}`).join(' &nbsp; ');
    const row = (table, total, becomes, add, have, skipped) => `<tr><td><code>${table}</code></td><td class="right">${fmtN(total)}</td><td>${becomes}</td><td class="right">${fmtN(add)}</td><td class="right">${fmtN(have)}</td><td class="right muted">${fmtN(skipped)}</td></tr>`;
    const memory = r => r.existing ? `<button class="pill" style="--c:var(--blue);cursor:pointer" data-open-person="${esc(r.existing.id)}">merges into ${esc(personLabel(r.existing))}</button>` : r.within ? '<span class="pill">same as an earlier row</span>' : '<span class="muted">new</span>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Old table</th><th class="right">Rows</th><th>Becomes</th><th class="right">New here</th><th class="right">Already here</th><th class="right">Skipped</th></tr></thead><tbody>
      ${row('never_mail', P.total, `People &nbsp; ${chips || '<span class="muted">—</span>'}`, P.add, P.merge, P.skipped)}
      ${row('bounce_suppression', B.total, 'Bounced addresses, kept as hard bounces with their dates', B.add, B.update, B.skipped)}
      ${row('sent_ledger', L.total, 'Mailed addresses, with first/last dates and counts', L.add, L.update, L.skipped)}
    </tbody></table></div>
    <div class="small muted mt-2">“Already here” rows update the existing record (emails and notes added, status updated, dates widened) instead of making a second one. Skipped rows have no usable email or company.${P.unknownReason ? ` ${fmtN(P.unknownReason)} ${P.unknownReason === 1 ? 'row has' : 'rows have'} a reason other than Client / Replied / Do not contact and become Do not contact.` : ''}</div>
    <div class="row wrap gap-3 mt-3 small"><span class="muted">Reason → status</span><span>Client → ${statusChip('client', { sm: true })}</span><span>Replied → ${statusChip('warm', { sm: true })}</span><span>Do not contact → ${statusChip('dnc', { sm: true })}</span></div>
    ${P.rows.length ? `<div class="table-wrap mt-3" style="max-height:34vh"><table class="table preview-table"><thead><tr><th>Company</th><th>Contact</th><th>Email</th><th>Status</th><th>Note</th><th>Memory</th></tr></thead><tbody>${P.rows.slice(0, 300).map(r => { const i = r.input; return `<tr><td title="${esc(i.company)}">${esc(i.company) || '<span class="muted">—</span>'}</td><td>${esc(i.name)}</td><td title="${esc(i.emails.join(', '))}">${esc(i.emails[0] || '') || '<span class="muted" title="No email: company-only record">no email</span>'}</td><td>${statusChip(i.status, { sm: true })}</td><td title="${esc(i.note)}">${esc(i.note.slice(0, 60))}${i.note.length > 60 ? '…' : ''}</td><td>${memory(r)}</td></tr>`; }).join('')}</tbody></table></div>${P.rows.length > 300 ? `<div class="small muted mt-1">Showing the first 300 of ${fmtN(P.rows.length)} people; all are imported.</div>` : ''}` : ''}`;
  },

  downloadBackup() {
    const m = openModal({ title: 'Download backup', size: 'sm', body: `<label class="toggle"><input type="checkbox" id="bk-enc" ${Store.meta.encrypted ? 'checked' : ''}><span class="tg"></span><span>Encrypt the file with a passphrase</span></label><div id="bk-pass" class="field mt-2" ${Store.meta.encrypted ? '' : 'hidden'}><label>Passphrase</label><input class="input" type="password" id="bk-p" autocomplete="off"><div class="hint">Needed to restore this file. Not stored anywhere.</div></div>`, foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Download</button>` });
    $('#bk-enc', m).onchange = e => { $('#bk-pass', m).hidden = !e.target.checked; };
    $('[data-cancel]', m).onclick = () => closeModal(m);
    $('[data-ok]', m).onclick = async () => {
      const enc = $('#bk-enc', m).checked, pass = $('#bk-p', m).value;
      if (enc && pass.length < 8) return toast('Use at least 8 characters.', 'warn');
      const obj = Store.exportObject({ includeActivity: true, includeTrash: true });
      const json = JSON.stringify(obj);
      const out = enc ? JSON.stringify(await encryptWithPass(json, pass)) : JSON.stringify(obj, null, 1);
      downloadText(`Reach backup ${stamp()}${enc ? ' (encrypted)' : ''}.json`, out, 'application/json');
      Store.log('export', `Downloaded a ${enc ? 'n encrypted' : ''} backup (${bytesFmt(out.length)}).`); Store.mark('activity');
      closeModal(m); toast('Backup downloaded.');
    };
  },
  async restoreFile(file) {
    try {
      let obj = JSON.parse(await readTextFile(file));
      if (obj && obj.encrypted) { const pass = await uiPrompt({ title: 'Encrypted backup', label: 'Passphrase', type: 'password', confirmLabel: 'Unlock' }); if (pass == null) return; try { obj = await decryptWithPass(obj, pass); } catch (e) { return toast('Wrong passphrase, or the file is damaged.', 'err'); } }
      if (!obj || obj.app !== 'reach') return toast('That is not a Reach backup file.', 'err');
      this.restoreChoice(obj, `${file.name} · ${fmtN((obj.people || []).length)} people, ${fmtN((obj.bounces || []).length)} bounces, ${fmtN((obj.ledger || []).length)} mailed, exported ${fmtDateTime(obj.exported_at)}`);
    } catch (e) { toastErr(e, 'Could not read that file.'); }
  },
  restoreChoice(obj, sub) {
    const m = openModal({ title: 'Restore how?', sub: esc(sub), body: `<div class="list-rows"><button class="list-row click" data-mode="merge"><span class="grow"><b>Merge into what is here</b><div class="small muted">Adds people, bounces, mailed addresses and campaigns that are missing; updates existing people without overwriting their notes.</div></span></button><button class="list-row click" data-mode="replace"><span class="grow"><b>Replace everything</b><div class="small muted">This device becomes an exact copy of the backup. A snapshot is taken first, so it can be undone.</div></span></button></div>` });
    $$('[data-mode]', m).forEach(b => b.onclick = async () => { closeModal(m); const p = startProgress().step('Restoring…', ''); try { if (b.dataset.mode === 'merge') { const r = await Store.mergeAll(obj); toast(`Merged: ${r.added} added, ${r.merged} updated.`); } else { await Store.replaceAll(obj); toast('Restored.'); } } catch (e) { toastErr(e); } finally { p.close(); } });
  },
  async restoreSnapshot(ts, body) {
    try { const obj = await Store.readSnapshot(ts); this.restoreChoice(obj, `Snapshot from ${fmtDateTime(ts)}`); } catch (e) { toastErr(e); }
  },
  async cloudRestoreModal() {
    let rows;
    try { rows = await Cloud.list(20); } catch (e) { return toastErr(e); }
    if (!rows.length) return toast('No backups in the cloud yet.', 'warn');
    const m = openModal({ title: 'Cloud backups', size: 'lg', body: `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>From</th><th>Kind</th><th>Contents</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td class="nowrap">${fmtDateTime(r.created_at)}</td><td class="small">${esc(r.device)}</td><td><span class="pill">${esc(r.label)}</span></td><td class="small muted">${fmtN(r.people)} people · ${fmtN(r.bounces)} bounces · ${fmtN(r.ledger)} mailed · ${bytesFmt(r.bytes)}</td><td class="right"><button class="btn btn-ghost btn-xs" data-id="${r.id}">Restore</button></td></tr>`).join('')}</tbody></table></div>` });
    $$('[data-id]', m).forEach(b => b.onclick = async () => {
      closeModal(m);
      try { const row = await Cloud.fetchOne(b.dataset.id); let obj; try { obj = await Cloud.decryptPayload(row.payload); } catch (e) { const pass = await uiPrompt({ title: 'That backup used a different passphrase', label: 'Passphrase', type: 'password', confirmLabel: 'Unlock' }); if (pass == null) return; obj = await Cloud.decryptPayload(row.payload, pass); } this.restoreChoice(obj, `Cloud backup from ${fmtDateTime(row.created_at)}`); }
      catch (e) { toastErr(e, 'Could not open that backup.'); }
    });
  },
  exportAllSheets() {
    if (typeof XLSX === 'undefined') return toast('The spreadsheet library is not loaded.', 'err');
    const s = Store.state, wb = XLSX.utils.book_new();
    const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
    add('People', [['Company', 'Contact', 'Emails', 'Status', 'Note', 'Tags', 'Domain', 'First contact', 'Last contact', 'Last reply', 'Revisit on', 'Source', 'Updated'], ...s.people.map(p => [p.company, p.name, p.emails.join(', '), STATUSES[p.status]?.label || p.status, p.note, (p.tags || []).join(', '), p.domain || '', p.first_contact, p.last_contact, p.last_reply, p.revisit_on, p.source, (p.updated_at || '').slice(0, 10)])]);
    add('Bounced', [['Email', 'Type', 'Reason', 'Date', 'Campaign', 'Times'], ...s.bounces.map(b => [b.email, b.type, b.reason, b.bounced_at, (s.campaigns.find(c => c.id === b.campaign_id) || {}).name || '', b.count])]);
    add('Mailed', [['Email', 'Domain', 'First', 'Last', 'Times'], ...s.ledger.map(l => [l.email, l.domain, l.first, l.last, l.count])]);
    add('Campaigns', [['Campaign', 'Sent on', 'Sent', 'Bounced', 'Replies', 'Rows', 'Blocked', 'Your call', 'File', 'Note'], ...s.campaigns.map(c => { const cs = Store.campaignStats(c); return [c.name, c.date, c.sent, cs.bounced, cs.replies, c.rows, c.block, c.ask, c.file, c.note]; })]);
    XLSX.writeFile(wb, `Reach sheets ${stamp()}.xlsx`);
    toast('Downloaded all sheets as one .xlsx.');
  },

  /* ---------- About ---------- */
  render_about(body) {
    body.innerHTML = `<div class="stack">
      <div class="card card-pad"><div class="brand" style="padding:0"><span class="brand-word" style="color:var(--ink-deep);font-size:2rem">Reach</span><span class="brand-dot"></span></div><div class="small muted mt-1">Outreach memory · version ${APP_VERSION} · local-first, no build step, no accounts.</div>
        <div class="sep"></div><h3 style="font-size:.95rem">How matching works</h3><ul class="small mt-2" style="color:var(--text-2);padding-left:1.2rem;line-height:1.7">
          <li><b>Email</b> — exact after normalising: spaces, capitals, <code>mailto:</code>, brackets, quotes and invisible characters are stripped. No Gmail dot tricks: <code>a.b@gmail.com</code> and <code>ab@gmail.com</code> stay different.</li>
          <li><b>Domain</b> — the registrable domain of the address (<code>mail.drukasia.com</code> → <code>drukasia.com</code>), never for free mailboxes. A <i>website</i> column is used when the email is a free mailbox.</li>
          <li><b>Company</b> — lower-cased, punctuation removed, suffixes stripped (Ltd, DMC, Tours, Association…). Equal names match; one name containing the other as whole words is “similar”.</li>
          <li><b>Name</b> — full contact names of two words or more, titles removed. Single first names never match on their own.</li>
          <li><b>Bounces and mailed</b> — exact address.</li></ul>
        <div class="sep"></div><div class="row wrap"><button class="btn btn-ghost btn-sm" data-shortcuts>${icon('command', 'ic-sm')}Keyboard shortcuts</button><span class="small muted">Fonts: Space Grotesk, Manrope, Space Mono, Fraunces. Spreadsheets: SheetJS Community Edition (bundled).</span></div></div></div>`;
    $('[data-shortcuts]', body).onclick = () => App.shortcuts();
  },
};
App.register('settings', SettingsView);
