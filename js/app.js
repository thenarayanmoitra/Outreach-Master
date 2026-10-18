/* =============================================================================
   Reach — app shell: boot, router, sidebar, top bar, search, undo, lock screen
   ============================================================================= */
'use strict';

const APP_VERSION = '4.0.0';
const App = {
  route: 'dashboard', sub: '', views: {}, firstRun: false, _idleTimer: null,
  nav: [
    { key: 'dashboard', label: 'Dashboard', icon: 'home' },
    { key: 'screen', label: 'Screen a list', icon: 'shield' },
    { key: 'bounces', label: 'Bounces', icon: 'mailx' },
    { key: 'sheets', label: 'Sheets', icon: 'sheet' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ],
  register(key, view) { this.views[key] = view; },

  async boot() {
    this.applyTheme(localStorage.getItem('reach.theme') || 'auto');
    const root = $('#app');
    try {
      const r = await Store.open();
      this.firstRun = !!r.firstRun;
      if (r.locked) { this.renderLock(root); return; }
      this.applyTheme(Store.state.settings.theme || 'auto');
      this.start(root);
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="lock-wrap"><div class="lock"><div class="brand"><span class="brand-word">Reach</span><span class="brand-dot"></span></div><h2>Couldn’t open the local database</h2><p>${esc(friendlyError(e))}</p><p class="small muted">Reach stores everything in this browser’s IndexedDB. Private windows, or a browser set to block site data, can’t keep anything.</p><button class="btn btn-primary mt-2" onclick="location.reload()">Try again</button></div></div>`;
    }
  },
  start(root) {
    root.innerHTML = `<div class="app"><aside class="side" id="side"></aside><div class="main-col"><div class="topbar" id="topbar"></div><main id="view"></main></div></div>`;
    this.renderSide(); this.renderTop();
    Store.on((type, d, e) => {
      if (type === 'save') this.renderSave(d, e);
      if (type === 'change' || type === 'load' || type === 'vault') { this.renderSide(); if (type !== 'change' || !(d && d.quiet)) this.rerender(); }
      if (type === 'lock') this.renderLock($('#app'));
      if (type === 'cloud') this.renderSide();
    });
    window.addEventListener('hashchange', () => this.routeFromHash());
    document.addEventListener('keydown', e => this.onKey(e));
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, () => this.touchIdle(), { passive: true }));
    this.touchIdle();
    this.routeFromHash();
    if (this.firstRun) setTimeout(() => this.welcome(), 300);
  },
  /* ---------- theme ---------- */
  applyTheme(t) {
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('reach.theme', t);
    $('meta[name=theme-color]').setAttribute('content', dark ? '#0B110D' : '#16241C');
  },
  async setTheme(t) { this.applyTheme(t); if (Store.state) await Store.saveSettings({ theme: t }); this.renderTop(); },
  isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; },
  /* ---------- routing ---------- */
  routeFromHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [r, sub] = h.split('/');
    this.route = this.views[r] ? r : 'dashboard'; this.sub = sub || '';
    closeDrawer(); closeMenu();
    this.renderSide(); this.rerender();
    $('#view').scrollTop = 0; window.scrollTo(0, 0);
  },
  go(route, sub = '') { const h = '#/' + route + (sub ? '/' + sub : ''); if (location.hash === h) this.routeFromHash(); else location.hash = h; },
  rerender() { if (!Store.state) return; const v = this.views[this.route]; if (v) v.render($('#view'), this.sub); },
  /* ---------- sidebar ---------- */
  counts() { const s = Store.state; return { people: s.people.length, bounces: s.bounces.length, ledger: s.ledger.length, campaigns: s.campaigns.length }; },
  renderSide() {
    const side = $('#side'); if (!side || !Store.state) return;
    const c = this.counts(); const s = Store.state.settings;
    const navCount = { screen: '', bounces: fmtN(c.bounces), sheets: fmtN(c.people), dashboard: '', settings: '' };
    const vault = Store.meta.encrypted ? `${icon('lock', 'ic-sm')}Vault on · encrypted` : `${icon('unlock', 'ic-sm')}Vault off · unencrypted`;
    const cloud = s.cloud.enabled ? `${icon('cloud', 'ic-sm')}Cloud backup ${s.cloud.lastBackup ? relTime(s.cloud.lastBackup) : 'never'}` : `${icon('cloud', 'ic-sm')}Cloud backup off`;
    side.innerHTML = `<div class="brand"><span class="brand-word">Reach</span><span class="brand-dot"></span></div><div class="brand-tag mono">Outreach memory</div>
      <nav class="side-nav">${this.nav.map(n => `<button class="nav-btn ${this.route === n.key ? 'active' : ''}" data-go="${n.key}">${icon(n.icon)}<span>${n.label}</span>${navCount[n.key] ? `<span class="nav-count">${navCount[n.key]}</span>` : ''}</button>`).join('')}</nav>
      <div class="side-foot">
        <div class="save-ind ${Store.saveState}" id="save-ind"><i></i><span>${this.saveText(Store.saveState)}</span></div>
        <button class="btn-side" data-go="settings/privacy">${vault}</button>
        <button class="btn-side" data-go="settings/backups">${cloud}</button>
        ${Store.meta.encrypted ? `<button class="btn-side" data-lock>${icon('lock', 'ic-sm')}Lock now</button>` : ''}
      </div>`;
    $$('[data-go]', side).forEach(b => b.onclick = () => { const [r, sub] = b.dataset.go.split('/'); this.go(r, sub); });
    const lk = $('[data-lock]', side); if (lk) lk.onclick = () => Store.lock();
  },
  saveText(st) { return { saved: 'Saved on this device', saving: 'Saving…', dirty: 'Unsaved changes', error: 'Save failed — retrying' }[st] || 'Saved'; },
  renderSave(st, e) { const el = $('#save-ind'); if (!el) return; el.className = 'save-ind ' + st; $('span', el).textContent = this.saveText(st); if (st === 'error' && e) toastErr(e, 'Could not save:'); },
  /* ---------- top bar ---------- */
  renderTop() {
    const tb = $('#topbar'); if (!tb) return;
    const theme = (Store.state && Store.state.settings.theme) || localStorage.getItem('reach.theme') || 'auto';
    tb.innerHTML = `<div class="search">${icon('search', 'ic-sm')}<input type="search" id="gsearch" placeholder="Look up any email, company or name…" autocomplete="off"><span class="kbd hide-sm">${MOD} K</span></div>
      <div class="row" style="margin-left:auto">
        <button class="btn btn-quiet btn-icon" id="undo-btn" title="Undo (${MOD}+Z)" ${Store.undoStack.length ? '' : 'disabled'}>${icon('undo')}</button>
        <button class="btn btn-quiet btn-icon" id="redo-btn" title="Redo (${MOD}+Shift+Z)" ${Store.redoStack.length ? '' : 'disabled'}>${icon('redo')}</button>
        <button class="btn btn-quiet btn-icon" id="theme-btn" title="Theme: ${theme}">${icon(this.isDark() ? 'sun' : 'moon')}</button>
        <button class="btn btn-quiet btn-icon hide-sm" id="help-btn" title="Shortcuts (?)">${icon('command')}</button>
      </div>`;
    $('#undo-btn').onclick = () => this.undo(); $('#redo-btn').onclick = () => this.redo();
    $('#theme-btn').onclick = e => openMenu(e.currentTarget, [{ label: 'Light', icon: 'sun', fn: () => this.setTheme('light') }, { label: 'Dark', icon: 'moon', fn: () => this.setTheme('dark') }, { label: 'Follow system', icon: 'sparkle', fn: () => this.setTheme('auto') }], { align: 'right' });
    $('#help-btn').onclick = () => this.shortcuts();
    this.wireSearch();
    Store.on(type => { if (type === 'change') { const u = $('#undo-btn'), r = $('#redo-btn'); if (u) u.disabled = !Store.undoStack.length; if (r) r.disabled = !Store.redoStack.length; } });
  },
  async undo() { const l = await Store.undo(); if (l) toast(`Undone: ${l}`, 'ok', { action: { label: 'Redo', fn: () => this.redo() } }); else toast('Nothing to undo', 'warn', { timeout: 1500 }); },
  async redo() { const l = await Store.redo(); if (l) toast(`Redone: ${l}`); else toast('Nothing to redo', 'warn', { timeout: 1500 }); },
  wireSearch() {
    const inp = $('#gsearch'), wrap = inp.parentElement;
    let pop = null, results = [], active = 0;
    const close = () => { if (pop) { pop.remove(); pop = null; } };
    const render = () => {
      close();
      const q = inp.value.trim(); if (!q) return;
      results = this.search(q);
      pop = document.createElement('div'); pop.className = 'search-pop';
      if (!results.length) pop.innerHTML = `<div class="sp-head small">Nothing in your memory matches “${esc(q)}”. ${normEmail(q).valid ? '<b>Safe to mail.</b>' : ''}</div>`;
      else pop.innerHTML = results.map((r, i) => `<button class="sp-row ${i === active ? 'active' : ''}" data-i="${i}">${r.icon}<div class="grow clip"><div class="clip"><b>${esc(r.title)}</b></div><div class="small muted clip">${r.sub}</div></div>${r.right || ''}</button>`).join('');
      wrap.appendChild(pop);
      $$('.sp-row', pop).forEach(b => b.onclick = () => { const r = results[+b.dataset.i]; close(); inp.value = ''; r.fn(); });
    };
    inp.addEventListener('input', debounce(() => { active = 0; render(); }, 80));
    inp.addEventListener('focus', () => { if (inp.value.trim()) render(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { inp.value = ''; close(); inp.blur(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r) { close(); inp.value = ''; r.fn(); } }
    });
    document.addEventListener('mousedown', e => { if (pop && !wrap.contains(e.target)) close(); });
  },
  search(q) {
    const idx = Store.getIndex(), s = q.toLowerCase(), out = [];
    const n = normEmail(q);
    const seen = new Set();
    const pushPerson = (p, why) => { if (seen.has(p.id)) return; seen.add(p.id); out.push({ icon: `<span class="avatar">${initials(personLabel(p))}</span>`, title: personLabel(p), sub: `${esc(personSub(p))}${why ? ' · ' + why : ''}`, right: statusChip(p.status, { sm: true }), fn: () => PeopleUI.open(p.id) }); };
    if (n.valid) {
      const p = idx.byEmail.get(n.email); if (p) pushPerson(p, 'exact address');
      const b = idx.bounces.get(n.email); if (b) out.push({ icon: `<span class="avatar" style="color:var(--red)">${icon('mailx')}</span>`, title: n.email, sub: `${b.type === 'soft' ? 'Soft' : 'Hard'} bounce on ${fmtDate(b.bounced_at)}${b.reason ? ' · ' + esc(b.reason) : ''}`, right: '<span class="pill" style="--c:var(--red)">Bounced</span>', fn: () => this.go('sheets', 'bounces') });
      const l = idx.ledger.get(n.email); if (l) out.push({ icon: `<span class="avatar" style="color:var(--blue)">${icon('send')}</span>`, title: n.email, sub: `Mailed ${l.count === 1 ? 'once' : l.count + ' times'}, last ${fmtDate(l.last)}`, right: '<span class="pill" style="--c:var(--blue)">Mailed before</span>', fn: () => this.go('sheets', 'mailed') });
      const d = rootDomain(emailDomain(n.email)); if (!idx.freeSet.has(d)) for (const p of idx.byDomain.get(d) || []) pushPerson(p, `same domain @${esc(d)}`);
    }
    for (const p of Store.state.people) {
      if (out.length >= 10) break;
      if (seen.has(p.id)) continue;
      const hay = `${p.company} ${p.name} ${p.emails.join(' ')} ${(p.tags || []).join(' ')}`.toLowerCase();
      if (hay.includes(s)) pushPerson(p, '');
    }
    if (out.length < 10 && s.length >= 3) for (const b of Store.state.bounces) { if (out.length >= 10) break; if (b.email.includes(s) && !(n.valid && b.email === n.email)) out.push({ icon: `<span class="avatar" style="color:var(--red)">${icon('mailx')}</span>`, title: b.email, sub: `Bounced ${fmtDate(b.bounced_at)}`, right: '<span class="pill" style="--c:var(--red)">Bounced</span>', fn: () => this.go('sheets', 'bounces') }); }
    return out;
  },
  /* ---------- keyboard ---------- */
  onKey(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); const s = $('#gsearch'); if (s) { s.focus(); s.select(); } return; }
    if (e.key === 'Escape') { if (_menu) closeMenu(); else if (_modals.length) { const m = _modals[_modals.length - 1]; if (m) closeModal(m); } else if (_drawer) closeDrawer(); return; }
    if (inField) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (e.key === '?') { this.shortcuts(); return; }
    if (!mod && !e.altKey && e.key.toLowerCase() === 'g') { this._g = Date.now(); return; }
    if (this._g && Date.now() - this._g < 900) { const map = { d: 'dashboard', s: 'screen', b: 'bounces', p: 'sheets', t: 'settings' }; const r = map[e.key.toLowerCase()]; if (r) { e.preventDefault(); this.go(r); } this._g = 0; }
  },
  shortcuts() {
    openModal({ title: 'Keyboard shortcuts', size: 'sm', body: `<div class="shortcut-list">
      <span>${kbdHint([MOD, 'K'])}</span><span>Look up any email, company or name</span>
      <span>${kbdHint([MOD, 'Z'])}</span><span>Undo the last change</span>
      <span>${kbdHint([MOD, '⇧', 'Z'])}</span><span>Redo</span>
      <span>${kbdHint(['G', 'D'])}</span><span>Go to Dashboard</span>
      <span>${kbdHint(['G', 'S'])}</span><span>Go to Screen a list</span>
      <span>${kbdHint(['G', 'B'])}</span><span>Go to Bounces</span>
      <span>${kbdHint(['G', 'P'])}</span><span>Go to Sheets</span>
      <span>${kbdHint(['G', 'T'])}</span><span>Go to Settings</span>
      <span>${kbdHint(['Esc'])}</span><span>Close panel, menu or editor</span>
      <span class="mono" style="grid-column:1/-1;margin-top:.5rem">In a sheet</span>
      <span>${kbdHint(['↑', '↓', '←', '→'])}</span><span>Move between cells</span>
      <span>${kbdHint(['Enter'])} / ${kbdHint(['F2'])}</span><span>Edit the cell (or just start typing)</span>
      <span>${kbdHint(['⇧', 'Enter'])}</span><span>Open the record</span>
      <span>${kbdHint(['Space'])}</span><span>Select the row · ${kbdHint([MOD, 'A'])} select all</span>
      <span>${kbdHint(['Tab'])}</span><span>Next cell · ${kbdHint([MOD, 'C'])} copy cell</span>
    </div>` });
  },
  /* ---------- idle auto-lock ---------- */
  touchIdle() {
    if (!Store.state || !Store.meta || !Store.meta.encrypted) return;
    clearTimeout(this._idleTimer);
    const mins = Number(Store.state.settings.lock.autoLockMinutes) || 0;
    if (mins > 0) this._idleTimer = setTimeout(() => { if (Store.meta.encrypted && !Store.locked) Store.lock(); }, mins * 60000);
  },
  /* ---------- lock screen ---------- */
  renderLock(root) {
    root.innerHTML = `<div class="lock-wrap"><form class="lock" id="lock-form"><div class="brand"><span class="brand-word">Reach</span><span class="brand-dot"></span></div><h2>Unlock your memory</h2><p>Everything is encrypted on this device. Enter your vault passphrase to open it.</p>
      <div class="field mt-3"><label>Passphrase</label><input class="input" type="password" id="lock-pass" autocomplete="current-password" autofocus></div>
      <label class="check mt-2"><input type="checkbox" id="lock-remember"> Keep unlocked in this tab</label>
      <div class="small muted mt-2" id="lock-err" hidden style="color:var(--red)">That passphrase didn’t work.</div>
      <button class="btn btn-primary btn-lg mt-3" style="width:100%" type="submit">Unlock</button>
      <p class="tiny muted mt-3">Forgot it? There is no reset: the data can only be read with the passphrase. You can restore a backup after wiping this device from the browser’s site settings.</p></form></div>`;
    const form = $('#lock-form'), pass = $('#lock-pass');
    form.onsubmit = async e => {
      e.preventDefault(); const btn = $('button[type=submit]', form); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Unlocking';
      try { const ok = await Store.unlock(pass.value, { remember: $('#lock-remember').checked }); if (!ok) { $('#lock-err').hidden = false; pass.value = ''; pass.focus(); btn.disabled = false; btn.textContent = 'Unlock'; return; } this.applyTheme(Store.state.settings.theme || 'auto'); this.start(root); }
      catch (err) { toastErr(err); btn.disabled = false; btn.textContent = 'Unlock'; }
    };
    setTimeout(() => pass.focus(), 50);
  },
  welcome() {
    const n = Store.state.people.length;
    const m = openModal({ title: `Welcome, ${esc(Store.state.settings.name)}.`, eyebrow: 'Reach 4', size: 'lg', body: `
      <p class="small" style="color:var(--text-2)">Your Response Tracker is loaded: <b>${fmtN(n)} people</b> are in memory with the statuses from your colour coding. Everything is editable in <b>Sheets</b>. Here is the loop:</p>
      <div class="steps mt-3">
        <div class="step"><div><b>Screen a list before you send</b><span>Drop any .xlsx / .csv (or paste from Google Sheets). Reach flags everyone you already know — clients, replies, bounces, same company — and gives you a clean list to download.</span></div></div>
        <div class="step"><div><b>Press “I sent this list”</b><span>Reach remembers every address you mailed, so the next list is checked against it too.</span></div></div>
        <div class="step"><div><b>Paste the bounces afterwards</b><span>Bounced addresses are blocked forever, and any list you sent from can be cleaned in one go.</span></div></div>
        <div class="step"><div><b>Log replies</b><span>When someone writes back, log it in two clicks. They move to Warm, Not now or Do not contact and are never cold-mailed again.</span></div></div>
      </div>
      <div class="callout accent mt-3">${icon('lock')}<div><b>Private by design.</b> Nothing leaves this browser. Turn on the vault lock in Settings → Privacy to encrypt everything at rest, and download a backup from Settings → Backups.</div></div>`,
      foot: `<button class="btn btn-quiet" data-settings>Open Settings</button><button class="btn btn-primary" data-ok>Go to the dashboard</button>` });
    $('[data-ok]', m).onclick = () => { closeModal(m); Store.saveSettings({ onboarded: true }); };
    $('[data-settings]', m).onclick = () => { closeModal(m); Store.saveSettings({ onboarded: true }); this.go('settings'); };
  },
};

document.addEventListener('DOMContentLoaded', () => App.boot());
