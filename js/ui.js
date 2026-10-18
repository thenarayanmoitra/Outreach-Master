/* =============================================================================
   Reach — UI toolkit: toasts, modals, drawer, menus, progress, dropzone,
   chips, tiny charts and the virtualised editable Grid.
   ============================================================================= */
'use strict';

/* ============================= TOAST ============================= */
function toast(msg, type = 'ok', { action = null, timeout = 4200, html = false } = {}) {
  let host = $('.toasts'); if (!host) { host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div'); el.className = `toast ${type}`;
  const ic = type === 'err' ? 'alert' : type === 'warn' ? 'info' : 'checkc';
  el.innerHTML = `${icon(ic)}<div class="msg">${html ? msg : esc(msg)}</div>${action ? `<button class="act">${esc(action.label)}</button>` : ''}<button class="tx" aria-label="Dismiss">${icon('x', 'ic-sm')}</button>`;
  const kill = () => { el.style.transition = 'opacity .18s, transform .18s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 180); };
  $('.tx', el).onclick = kill;
  if (action) $('.act', el).onclick = async () => { kill(); try { await action.fn(); } catch (e) { toastErr(e); } };
  host.appendChild(el);
  while (host.children.length > 4) host.firstChild.remove();
  if (timeout) setTimeout(kill, action ? Math.max(timeout, 7000) : timeout);
  return el;
}
function friendlyError(e) {
  const m = (e && e.message) || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No connection. Check your internet (or the Supabase project is paused).';
  if (/QuotaExceeded/i.test(m)) return 'The browser is out of storage space for this site.';
  return m;
}
function toastErr(e, prefix = '') { console.error(e); toast((prefix ? prefix + ' ' : '') + friendlyError(e), 'err', { timeout: 7000 }); }

/* ============================= MODAL ============================= */
const _modals = [];
function openModal({ title = '', eyebrow = '', sub = '', size = '', body = '', foot = '', onClose = null, dismissable = true } = {}) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><div class="grow">${eyebrow ? `<div class="mono eyebrow">${esc(eyebrow)}</div>` : ''}<h2>${esc(title)}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${dismissable ? `<button class="modal-x btn-icon" aria-label="Close">${icon('x')}</button>` : ''}</div>
    <div class="modal-body"></div>${foot ? `<div class="modal-foot"></div>` : ''}</div>`;
  const bodyEl = $('.modal-body', back); if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  if (foot) { const f = $('.modal-foot', back); if (typeof foot === 'string') f.innerHTML = foot; else f.appendChild(foot); }
  back.close = () => closeModal(back);
  back._onClose = onClose;
  if (dismissable) { $('.modal-x', back).onclick = back.close; back.addEventListener('mousedown', e => { if (e.target === back) back.close(); }); }
  document.body.appendChild(back); _modals.push(back);
  setTimeout(() => { const f = $('[autofocus], input:not([type=hidden]), textarea, select, button.btn-primary, button.btn-accent', bodyEl) || $('.modal-foot button', back); if (f) f.focus(); }, 30);
  return back;
}
function closeModal(el) { if (!el || !el.isConnected) return; el.remove(); const i = _modals.indexOf(el); if (i > -1) _modals.splice(i, 1); if (el._onClose) el._onClose(); }
function uiConfirm({ title, message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, typed = '', alert = false, size = 'sm' }) {
  return new Promise(res => {
    const m = openModal({ title, size, body: `${message ? `<div class="small" style="color:var(--text-2)">${message}</div>` : ''}${typed ? `<div class="field mt-3"><label>Type <code>${esc(typed)}</code> to confirm</label><input class="input" id="cf-typed" autocomplete="off" autofocus></div>` : ''}`,
      foot: alert ? `<button class="btn btn-primary" data-ok>${esc(confirmLabel)}</button>` : `<button class="btn btn-quiet" data-cancel>${esc(cancelLabel)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok ${typed ? 'disabled' : ''}>${esc(confirmLabel)}</button>`,
      onClose: () => res(false) });
    const ok = $('[data-ok]', m);
    if (typed) $('#cf-typed', m).oninput = e => { ok.disabled = e.target.value.trim() !== typed; };
    ok.onclick = () => { m._onClose = null; closeModal(m); res(true); };
    const c = $('[data-cancel]', m); if (c) c.onclick = () => m.close();
    if (!typed) setTimeout(() => ok.focus(), 40);
  });
}
function uiPrompt({ title, message = '', label = '', value = '', placeholder = '', type = 'text', confirmLabel = 'Save', multiline = false, size = 'sm' }) {
  return new Promise(res => {
    const m = openModal({ title, size, body: `${message ? `<div class="small mb-2" style="color:var(--text-2)">${message}</div>` : ''}<div class="field">${label ? `<label>${esc(label)}</label>` : ''}${multiline ? `<textarea class="textarea" id="pr-v" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" id="pr-v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>`}</div>`,
      foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>${esc(confirmLabel)}</button>`, onClose: () => res(null) });
    const inp = $('#pr-v', m);
    const done = () => { m._onClose = null; closeModal(m); res(inp.value); };
    $('[data-ok]', m).onclick = done; $('[data-cancel]', m).onclick = () => m.close();
    if (!multiline) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
    setTimeout(() => { inp.focus(); if (!multiline) inp.select(); }, 40);
  });
}

/* ============================= DRAWER ============================= */
let _drawer = null;
function openDrawer({ title = '', sub = '', body = '', foot = '', onClose = null } = {}) {
  closeDrawer();
  const back = document.createElement('div'); back.className = 'drawer-back';
  const d = document.createElement('aside'); d.className = 'drawer'; d.setAttribute('role', 'dialog');
  d.innerHTML = `<div class="drawer-head"><div class="grow"><h2>${esc(title)}</h2>${sub ? `<div class="small muted mt-1">${sub}</div>` : ''}</div><button class="modal-x btn-icon" aria-label="Close">${icon('x')}</button></div><div class="drawer-body"></div>${foot ? '<div class="drawer-foot"></div>' : ''}`;
  const b = $('.drawer-body', d); if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
  if (foot) { const f = $('.drawer-foot', d); if (typeof foot === 'string') f.innerHTML = foot; else f.appendChild(foot); }
  d._onClose = onClose;
  $('.modal-x', d).onclick = closeDrawer; back.onclick = closeDrawer;
  document.body.append(back, d);
  _drawer = { back, d };
  return d;
}
function closeDrawer() { if (!_drawer) return; const { back, d } = _drawer; _drawer = null; back.remove(); d.remove(); if (d._onClose) d._onClose(); }
function setDrawerTitle(title, sub) { if (!_drawer) return; $('.drawer-head h2', _drawer.d).textContent = title; const s = $('.drawer-head .small', _drawer.d); if (s && sub != null) s.innerHTML = sub; }

/* ============================= PROGRESS ============================= */
function startProgress() {
  const back = document.createElement('div'); back.className = 'progress-back';
  back.innerHTML = `<div class="progress"><h3 id="pg-t">Working…</h3><p id="pg-s"></p><div class="bar indet"><i style="width:0%"></i></div><div class="tiny muted mt-2 num" id="pg-n"></div></div>`;
  document.body.appendChild(back);
  let total = 0;
  const api = {
    step(title, sub = '', tot = 0) { $('#pg-t', back).textContent = title; $('#pg-s', back).textContent = sub; total = tot; $('.bar', back).classList.toggle('indet', !tot); $('.bar i', back).style.width = '0%'; $('#pg-n', back).textContent = ''; return api; },
    set(n) { if (!total) return; $('.bar i', back).style.width = `${clamp(100 * n / total, 0, 100).toFixed(1)}%`; $('#pg-n', back).textContent = `${fmtN(n)} / ${fmtN(total)}`; },
    close() { back.remove(); },
  };
  return api;
}

/* ============================= MENU ============================= */
let _menu = null;
function closeMenu() { if (_menu) { _menu.remove(); _menu = null; document.removeEventListener('mousedown', _menuDoc, true); } }
function _menuDoc(e) { if (_menu && !_menu.contains(e.target)) closeMenu(); }
function openMenu(anchor, items, { align = 'left' } = {}) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu';
  m.innerHTML = items.map(it => it.sep ? '<div class="msep"></div>' : it.head ? `<div class="mhead mono">${esc(it.head)}</div>` : `<button class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 'ic-sm') : ''}<span>${esc(it.label)}</span>${it.right ? `<span class="muted tiny" style="margin-left:auto">${esc(it.right)}</span>` : ''}</button>`).join('');
  document.body.appendChild(m); _menu = m;
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left; left = clamp(left, 8, window.innerWidth - mw - 8);
  let top = r.bottom + 6; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  const btns = $$('button', m); let bi = 0;
  items.filter(it => !it.sep && !it.head).forEach((it, i) => { btns[i].onclick = e => { e.stopPropagation(); closeMenu(); it.fn && it.fn(); }; });
  setTimeout(() => document.addEventListener('mousedown', _menuDoc, true), 0);
  m.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); if (e.key === 'ArrowDown') { bi = (bi + 1) % btns.length; btns[bi].focus(); } if (e.key === 'ArrowUp') { bi = (bi - 1 + btns.length) % btns.length; btns[bi].focus(); } });
  if (btns.length) btns[0].focus();
  return m;
}

/* ============================= DROPZONE ============================= */
function wireDropzone(dz, onFiles) {
  const inp = $('input[type=file]', dz);
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); const files = [...(e.dataTransfer.files || [])]; if (files.length) onFiles(files); });
  if (inp) inp.addEventListener('change', () => { const files = [...inp.files]; inp.value = ''; if (files.length) onFiles(files); });
  dz.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && inp) { e.preventDefault(); inp.click(); } });
}
function dropzoneHtml({ title = 'Drop a .xlsx or .csv here', text = 'or click to choose a file', accept = '.xlsx,.xls,.csv,.tsv,.txt', multiple = false } = {}) {
  return `<div class="dropzone" tabindex="0"><div class="dz-icon">${icon('upload', 'ic-lg')}</div><h3>${esc(title)}</h3><p>${esc(text)}</p><input type="file" accept="${accept}" ${multiple ? 'multiple' : ''} aria-label="Choose file"></div>`;
}

/* ============================= CHIPS & BITS ============================= */
function statusChip(status, { sm = false, dot = true } = {}) {
  const S = STATUSES[status] || { label: status || '—', color: 'var(--grey)', bg: 'var(--grey-bg)' };
  return `<span class="chip ${sm ? 'sm' : ''}" style="--c:${S.color};--c-bg:${S.bg}">${dot ? '<i class="dot"></i>' : ''}${esc(S.label)}</span>`;
}
function verdictBadge(v) {
  const map = { ready: ['check', 'Ready'], ask: ['alert', 'Your call'], block: ['ban', 'Blocked'] };
  const [ic, label] = map[v] || ['info', v];
  return `<span class="verdict ${v}">${icon(ic, 'ic-sm')}${label}</span>`;
}
function reasonPill(key, level) {
  const R = REASONS[key] || { label: key, color: 'var(--grey)', icon: 'info' };
  return `<span class="pill" style="--c:${R.color}" title="${esc(R.desc || '')}">${icon(R.icon)}${esc(R.label)}</span>`;
}
function tagHtml(t, removable = false) { return `<span class="tag">${esc(t)}${removable ? `<button data-rm-tag="${esc(t)}" aria-label="Remove tag">${icon('x', 'ic-sm')}</button>` : ''}</span>`; }
function initials(name) { const w = String(name || '').trim().split(/\s+/).filter(Boolean); return (w.length ? (w[0][0] + (w[1] ? w[1][0] : '')) : '?').toUpperCase(); }
function emptyState({ icon: ic = 'inbox', title, text = '', action = '' }) { return `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`; }
function pageHead({ eyebrow = '', title, lede = '', actions = '' }) {
  return `<div class="page-head"><div>${eyebrow ? `<div class="mono eyebrow">${esc(eyebrow)}</div>` : ''}<h1>${esc(title)}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
function statTile({ label, value, sub = '', color = '', onClickAttr = '' }) {
  return `<${onClickAttr ? 'button' : 'div'} class="stat ${onClickAttr ? 'link' : ''}" style="--stat-c:${color || 'transparent'}" ${onClickAttr}><div class="stat-label mono">${esc(label)}</div><div class="stat-value num">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</${onClickAttr ? 'button' : 'div'}>`;
}
function kbdHint(keys) { return keys.map(k => `<span class="kbd">${esc(k)}</span>`).join(' '); }
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

/* ============================= CHARTS ============================= */
function barList(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="barlist">${items.map(i => `<div class="bl"><span class="clip">${esc(i.label)}</span><div class="track"><i style="width:${(100 * i.value / max).toFixed(1)}%;--c:${i.color || 'var(--accent)'}"></i></div><span class="v">${i.display != null ? i.display : fmtN(i.value)}</span></div>`).join('')}</div>`;
}
function mixBar(items) {
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  return `<div class="mix">${items.filter(i => i.value > 0).map(i => `<i style="width:${(100 * i.value / total).toFixed(2)}%;--c:${i.color}" title="${esc(i.label)}: ${fmtN(i.value)}"></i>`).join('')}</div><div class="legend">${items.map(i => `<span><i style="--c:${i.color}"></i>${esc(i.label)} <b class="num">${fmtN(i.value)}</b></span>`).join('')}</div>`;
}
function sparkBars(values, color = 'var(--accent)') {
  const max = Math.max(1, ...values);
  return `<div class="spark">${values.map(v => `<i style="height:${Math.max(4, 100 * v / max).toFixed(0)}%;--c:${color}" title="${fmtN(v)}"></i>`).join('')}</div>`;
}

/* ============================= GRID =============================
   Virtualised, editable, sortable grid used for every sheet.
   columns: { key, label, width, type, editable, options, render, get, set, sortVal, align, nosort }
   types: text | select | date | number | emails | tags | status | note | check | custom */
class Grid {
  constructor(opts) {
    this.o = Object.assign({ rowHeight: 40, selectable: true, columns: [], rows: [], getId: r => r.id, onEdit: null, onOpen: null, onSelection: null, searchText: null, empty: null, storageKey: '', openable: true, maxHeight: '' }, opts);
    this.rows = this.o.rows; this.view = this.rows; this.sel = new Set(); this.sort = this.o.sort || null; this.q = ''; this.active = null; this.editing = null; this.hidden = new Set();
    this.anchor = null;
    try { const st = JSON.parse(localStorage.getItem('reach.grid.' + this.o.storageKey) || '{}'); if (st.sort) this.sort = st.sort; if (st.hidden) this.hidden = new Set(st.hidden); } catch (e) { /* ignore */ }
    this.el = document.createElement('div'); this.el.className = 'grid';
    if (this.o.maxHeight) this.el.style.setProperty('--grid-max', this.o.maxHeight);
    this.el.innerHTML = `<div class="grid-toolbar"></div><div class="bulkbar" hidden></div><div class="grid-scroll" tabindex="0"><div class="grid-table"></div></div><div class="grid-foot"></div>`;
    this.tb = $('.grid-toolbar', this.el); this.bulk = $('.bulkbar', this.el); this.sc = $('.grid-scroll', this.el); this.tbl = $('.grid-table', this.el); this.foot = $('.grid-foot', this.el);
    this.renderToolbar();
    this.sc.addEventListener('scroll', () => this.onScroll());
    this.sc.addEventListener('keydown', e => this.onKey(e));
    this.tbl.addEventListener('click', e => this.onClick(e));
    this.tbl.addEventListener('dblclick', e => this.onDbl(e));
    this.ro = new ResizeObserver(() => this.renderBody());
    this.ro.observe(this.sc);
    this.applyView();
  }
  saveUi() { try { localStorage.setItem('reach.grid.' + this.o.storageKey, JSON.stringify({ sort: this.sort, hidden: [...this.hidden] })); } catch (e) { /* ignore */ } }
  cols() { return this.o.columns.filter(c => !this.hidden.has(c.key)); }
  renderToolbar() {
    const o = this.o;
    this.tb.innerHTML = `<div class="search">${icon('search', 'ic-sm')}<input type="search" placeholder="${esc(o.searchPlaceholder || 'Search…')}" aria-label="Search"></div><div class="row grow wrap" data-slot></div><button class="btn btn-ghost btn-sm" data-cols>${icon('columns', 'ic-sm')}<span class="hide-sm">Columns</span></button>`;
    const inp = $('input', this.tb);
    inp.addEventListener('input', debounce(() => { this.q = inp.value.trim().toLowerCase(); this.applyView(); }, 120));
    $('[data-cols]', this.tb).onclick = e => openMenu(e.currentTarget, this.o.columns.filter(c => c.key !== '_check').map(c => ({ label: (this.hidden.has(c.key) ? '○  ' : '●  ') + c.label, fn: () => { this.hidden.has(c.key) ? this.hidden.delete(c.key) : this.hidden.add(c.key); this.saveUi(); this.applyView(); } })), { align: 'right' });
    this.slot = $('[data-slot]', this.tb);
    if (o.toolbar) { if (typeof o.toolbar === 'string') this.slot.innerHTML = o.toolbar; else this.slot.appendChild(o.toolbar); }
  }
  setRows(rows) { this.rows = rows; const ids = new Set(rows.map(this.o.getId)); for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id); this.applyView(); }
  applyView() {
    let v = this.rows;
    if (this.q && this.o.searchText) { const q = this.q; v = v.filter(r => this.o.searchText(r).toLowerCase().includes(q)); }
    if (this.o.filter) v = v.filter(this.o.filter);
    if (this.sort) {
      const col = this.o.columns.find(c => c.key === this.sort.key);
      if (col) { const dir = this.sort.dir; const sv = col.sortVal || (r => col.get ? col.get(r) : r[col.key]); v = v.slice().sort((a, b) => { const x = sv(a), y = sv(b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x > y ? 1 : x < y ? -1 : 0) * dir; }); }
    }
    this.view = v;
    this.renderHead(); this.renderBody(); this.renderFoot(); this.renderBulk();
  }
  template() { return this.cols().map(c => c.width || 'minmax(140px,1fr)').join(' '); }
  renderHead() {
    this.tbl.style.gridTemplateColumns = this.template();
    const head = this.cols().map(c => {
      if (c.key === '_check') return `<div class="nosort"><input type="checkbox" aria-label="Select all" data-all ${this.view.length && this.view.every(r => this.sel.has(this.o.getId(r))) ? 'checked' : ''}></div>`;
      if (c.key === '_open') return `<div class="nosort"></div>`;
      const sorted = this.sort && this.sort.key === c.key;
      return `<div class="${sorted ? 'sorted' : ''} ${c.nosort ? 'nosort' : ''}" data-sort="${esc(c.key)}" style="${c.align === 'right' ? 'justify-content:flex-end' : ''}"><span>${esc(c.label)}</span>${sorted ? icon(this.sort.dir > 0 ? 'arrowUp' : 'chevronD') : ''}</div>`;
    }).join('');
    this.headHtml = `<div class="grid-head">${head}</div>`;
  }
  onScroll() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = null; this.renderBody(); }); }
  renderBody() {
    const rh = this.o.rowHeight, n = this.view.length;
    const h = this.sc.clientHeight || 400, top = this.sc.scrollTop;
    const start = Math.max(0, Math.floor(top / rh) - 6), end = Math.min(n, Math.ceil((top + h) / rh) + 6);
    const cols = this.cols();
    let html = this.headHtml;
    if (!n) { html += `<div class="grid-empty" style="grid-column:1/-1">${this.o.empty || (this.q ? 'Nothing matches your search.' : 'Nothing here yet.')}</div>`; }
    else {
      html += `<div style="grid-column:1/-1;height:${start * rh}px"></div>`;
      for (let i = start; i < end; i++) {
        const r = this.view[i], id = this.o.getId(r);
        const cls = (this.sel.has(id) ? 'sel ' : '') + (this.o.rowClass ? this.o.rowClass(r) : '');
        html += `<div class="grid-row ${cls}" data-i="${i}">`;
        cols.forEach((c, ci) => {
          const act = this.active && this.active.i === i && this.active.c === ci;
          html += `<div class="grid-cell ${c.editable ? 'editable' : ''} ${act ? 'active' : ''} ${c.align === 'right' ? 'num' : ''}" data-c="${ci}" data-i="${i}">${this.cellHtml(c, r, id)}</div>`;
        });
        html += '</div>';
      }
      html += `<div style="grid-column:1/-1;height:${Math.max(0, (n - end) * rh)}px"></div>`;
    }
    this.tbl.innerHTML = html;
    if (this.editing) this.mountEditor();
  }
  cellHtml(c, r, id) {
    if (c.key === '_check') return `<input type="checkbox" data-sel="${esc(id)}" ${this.sel.has(id) ? 'checked' : ''} aria-label="Select row">`;
    if (c.key === '_open') return `<button class="btn btn-icon btn-quiet" data-open title="Open (Shift+Enter)">${icon('chevronR', 'ic-sm')}</button>`;
    if (c.render) return c.render(r);
    const v = c.get ? c.get(r) : r[c.key];
    switch (c.type) {
      case 'status': return statusChip(v, { sm: true });
      case 'date': return `<span class="clip">${v ? fmtDate(v) : '<span class="muted">—</span>'}</span>`;
      case 'number': return `<span class="num">${fmtN(v)}</span>`;
      case 'emails': return `<span class="clip">${(v || []).length ? esc(v[0]) : '<span class="muted">—</span>'}</span>${(v || []).length > 1 ? `<span class="cell-sub">+${v.length - 1}</span>` : ''}`;
      case 'tags': return `<span class="row gap-1 clip">${(v || []).map(t => tagHtml(t)).join('') || '<span class="muted">—</span>'}</span>`;
      case 'select': { const opt = (c.options || []).find(o => o.value === v); return `<span class="clip">${esc(opt ? opt.label : v || '')}</span>`; }
      case 'check': return `<input type="checkbox" ${v ? 'checked' : ''} data-chk aria-label="${esc(c.label)}">`;
      default: return `<span class="clip" title="${esc(v == null ? '' : String(v))}">${v == null || v === '' ? '<span class="muted">—</span>' : esc(String(v).split('\n')[0])}</span>`;
    }
  }
  renderFoot() {
    const n = this.view.length, t = this.rows.length;
    this.foot.innerHTML = `<span class="num">${n === t ? plural(t, 'row') : `${fmtN(n)} of ${fmtN(t)} rows`}</span>${this.sel.size ? `<span class="num">· ${fmtN(this.sel.size)} selected</span>` : ''}<span class="hide-sm" style="margin-left:auto">${kbdHint(['Enter'])} edit · ${kbdHint(['⇧', 'Enter'])} open · ${kbdHint(['Space'])} select · ${kbdHint(['Esc'])} cancel</span>`;
  }
  renderBulk() {
    const n = this.sel.size;
    this.bulk.hidden = !n || !(this.o.bulk && this.o.bulk.length);
    if (this.bulk.hidden) return;
    this.bulk.innerHTML = `<b class="num small">${fmtN(n)} selected</b>${this.o.bulk.map((b, i) => `<button class="btn btn-quiet btn-sm" data-bulk="${i}">${b.icon ? icon(b.icon, 'ic-sm') : ''}${esc(b.label)}</button>`).join('')}<button class="btn btn-quiet btn-sm" data-bulk-clear style="margin-left:auto">${icon('x', 'ic-sm')}Clear</button>`;
    $$('[data-bulk]', this.bulk).forEach(b => b.onclick = () => this.o.bulk[+b.dataset.bulk].fn([...this.sel], this));
    $('[data-bulk-clear]', this.bulk).onclick = () => this.clearSelection();
  }
  getSelected() { return [...this.sel]; }
  clearSelection() { this.sel.clear(); this.applyView(); this.o.onSelection && this.o.onSelection([]); }
  selectIds(ids) { this.sel = new Set(ids); this.applyView(); this.o.onSelection && this.o.onSelection([...this.sel]); }
  onClick(e) {
    const headSort = e.target.closest('[data-sort]');
    if (headSort && !headSort.classList.contains('nosort')) { const k = headSort.dataset.sort; this.sort = this.sort && this.sort.key === k ? (this.sort.dir > 0 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 }; this.saveUi(); this.applyView(); return; }
    const all = e.target.closest('[data-all]');
    if (all) { if (all.checked) for (const r of this.view) this.sel.add(this.o.getId(r)); else for (const r of this.view) this.sel.delete(this.o.getId(r)); this.applyView(); this.o.onSelection && this.o.onSelection([...this.sel]); return; }
    const selBox = e.target.closest('[data-sel]');
    const cell = e.target.closest('.grid-cell'); if (!cell) return;
    const i = +cell.dataset.i, ci = +cell.dataset.c, r = this.view[i], id = this.o.getId(r);
    if (selBox) {
      if (e.shiftKey && this.anchor != null) { const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)]; for (let k = a; k <= b; k++) this.sel.add(this.o.getId(this.view[k])); }
      else { selBox.checked ? this.sel.add(id) : this.sel.delete(id); }
      this.anchor = i; this.applyView(); this.o.onSelection && this.o.onSelection([...this.sel]); return;
    }
    if (e.target.closest('[data-open]')) { this.o.onOpen && this.o.onOpen(r); return; }
    const chk = e.target.closest('[data-chk]');
    if (chk) { const c = this.cols()[ci]; this.commitEdit(r, c, chk.checked); return; }
    if (this.editing) this.stopEdit(true);
    this.setActive(i, ci);
    this.sc.focus({ preventScroll: true });
  }
  onDbl(e) {
    const cell = e.target.closest('.grid-cell'); if (!cell || e.target.closest('input,button')) return;
    const i = +cell.dataset.i, ci = +cell.dataset.c; this.setActive(i, ci); this.startEdit();
  }
  setActive(i, ci) {
    const prev = $('.grid-cell.active', this.tbl); if (prev) prev.classList.remove('active');
    this.active = { i, c: ci };
    const el = $(`.grid-cell[data-i="${i}"][data-c="${ci}"]`, this.tbl); if (el) el.classList.add('active');
    const rh = this.o.rowHeight, top = i * rh, bottom = top + rh, st = this.sc.scrollTop, h = this.sc.clientHeight;
    if (top < st + 36) this.sc.scrollTop = Math.max(0, top - 36); else if (bottom > st + h) this.sc.scrollTop = bottom - h;
  }
  onKey(e) {
    if (this.editing) return;
    if (!this.active) { if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) && this.view.length) { e.preventDefault(); this.setActive(0, this.firstEditableCol()); } return; }
    const { i, c } = this.active, cols = this.cols(), n = this.view.length;
    const mv = (di, dc) => { e.preventDefault(); this.setActive(clamp(i + di, 0, n - 1), clamp(c + dc, 0, cols.length - 1)); };
    switch (e.key) {
      case 'ArrowDown': mv(1, 0); break;
      case 'ArrowUp': mv(-1, 0); break;
      case 'ArrowRight': mv(0, 1); break;
      case 'ArrowLeft': mv(0, -1); break;
      case 'PageDown': mv(Math.floor(this.sc.clientHeight / this.o.rowHeight), 0); break;
      case 'PageUp': mv(-Math.floor(this.sc.clientHeight / this.o.rowHeight), 0); break;
      case 'Home': if (e.metaKey || e.ctrlKey) { e.preventDefault(); this.setActive(0, c); } else mv(0, -99); break;
      case 'End': if (e.metaKey || e.ctrlKey) { e.preventDefault(); this.setActive(n - 1, c); } else mv(0, 99); break;
      case 'Tab': e.preventDefault(); if (e.shiftKey) { if (c > 0) mv(0, -1); else if (i > 0) this.setActive(i - 1, cols.length - 1); } else { if (c < cols.length - 1) mv(0, 1); else if (i < n - 1) this.setActive(i + 1, 0); } break;
      case 'Enter': e.preventDefault(); if (e.shiftKey) { this.o.onOpen && this.o.onOpen(this.view[i]); } else if (cols[c].editable) this.startEdit(); else if (this.o.onOpen && this.o.openable) this.o.onOpen(this.view[i]); break;
      case 'F2': e.preventDefault(); this.startEdit(); break;
      case ' ': { e.preventDefault(); const id = this.o.getId(this.view[i]); this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); this.anchor = i; this.applyView(); this.o.onSelection && this.o.onSelection([...this.sel]); break; }
      case 'Escape': this.active = null; this.renderBody(); break;
      case 'a': if (e.metaKey || e.ctrlKey) { e.preventDefault(); for (const r of this.view) this.sel.add(this.o.getId(r)); this.applyView(); this.o.onSelection && this.o.onSelection([...this.sel]); } break;
      case 'c': if ((e.metaKey || e.ctrlKey)) { const col = cols[c], r = this.view[i]; const v = col.get ? col.get(r) : r[col.key]; copyText(Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v)); toast('Copied', 'ok', { timeout: 1200 }); } break;
      case 'Backspace': case 'Delete': if (cols[c].editable && ['text', 'date', 'note', 'tags', 'emails'].includes(cols[c].type || 'text')) { e.preventDefault(); this.startEdit(''); } break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && cols[c].editable && ['text', 'note', 'tags', 'emails', 'number'].includes(cols[c].type || 'text')) { e.preventDefault(); this.startEdit(e.key); }
    }
  }
  firstEditableCol() { const cols = this.cols(); const i = cols.findIndex(c => c.key !== '_check' && c.key !== '_open'); return Math.max(0, i); }
  startEdit(initial) {
    if (!this.active) return;
    const col = this.cols()[this.active.c]; if (!col || !col.editable) return;
    const r = this.view[this.active.i];
    const v = col.get ? col.get(r) : r[col.key];
    this.editing = { i: this.active.i, c: this.active.c, col, r, initial, orig: v };
    this.mountEditor();
  }
  mountEditor() {
    const ed = this.editing; const cell = $(`.grid-cell[data-i="${ed.i}"][data-c="${ed.c}"]`, this.tbl); if (!cell) return;
    if ($('.grid-editor', cell)) return;
    const col = ed.col, v = ed.orig;
    const wrap = document.createElement('div'); wrap.className = 'grid-editor';
    let inp;
    const type = col.type || 'text';
    if (type === 'select' || type === 'status') {
      inp = document.createElement('select');
      const opts = type === 'status' ? STATUS_KEYS.map(k => ({ value: k, label: STATUSES[k].label })) : (col.options || []);
      inp.innerHTML = opts.map(o => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    } else if (type === 'date') { inp = document.createElement('input'); inp.type = 'date'; inp.value = toISODate(v) || ''; }
    else if (type === 'note') { inp = document.createElement('textarea'); inp.value = ed.initial != null ? ed.initial : (v || ''); wrap.style.height = 'auto'; wrap.style.bottom = 'auto'; wrap.style.zIndex = 20; }
    else { inp = document.createElement('input'); inp.type = 'text'; inp.value = ed.initial != null ? ed.initial : (Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v))); }
    wrap.appendChild(inp); cell.appendChild(wrap);
    inp.focus(); if (inp.select && ed.initial == null && type !== 'date') inp.select(); else if (inp.setSelectionRange && type !== 'date' && type !== 'select' && type !== 'status') { const l = inp.value.length; inp.setSelectionRange(l, l); }
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.stopEdit(false); this.sc.focus({ preventScroll: true }); }
      else if (e.key === 'Enter' && (type !== 'note' || e.metaKey || e.ctrlKey)) { e.preventDefault(); this.stopEdit(true); this.sc.focus({ preventScroll: true }); const n = this.view.length; if (!e.shiftKey && this.active && this.active.i < n - 1) this.setActive(this.active.i + 1, this.active.c); }
      else if (e.key === 'Tab') { e.preventDefault(); this.stopEdit(true); this.sc.focus({ preventScroll: true }); const cols = this.cols(); if (this.active) { if (e.shiftKey) this.setActive(this.active.i, Math.max(0, this.active.c - 1)); else this.setActive(this.active.i, Math.min(cols.length - 1, this.active.c + 1)); } }
    });
    inp.addEventListener('blur', () => { setTimeout(() => { if (this.editing === ed && !wrap.contains(document.activeElement)) this.stopEdit(true); }, 60); });
    if (type === 'select' || type === 'status') inp.addEventListener('change', () => { this.stopEdit(true); this.sc.focus({ preventScroll: true }); });
    ed.inp = inp;
  }
  stopEdit(commit) {
    const ed = this.editing; if (!ed) return;
    this.editing = null;
    const cell = $(`.grid-cell[data-i="${ed.i}"][data-c="${ed.c}"]`, this.tbl);
    const wrap = cell && $('.grid-editor', cell);
    if (commit && ed.inp) {
      let val = ed.inp.value;
      const type = ed.col.type || 'text';
      if (type === 'tags' || type === 'emails') val = val.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
      else if (type === 'number') val = Number(val) || 0;
      else if (type === 'date') val = val ? toISODate(val) : '';
      const same = JSON.stringify(val) === JSON.stringify(ed.orig == null ? (type === 'tags' || type === 'emails' ? [] : '') : ed.orig);
      if (!same) this.commitEdit(ed.r, ed.col, val, ed.orig);
    }
    if (wrap) wrap.remove();
    this.renderBody();
  }
  commitEdit(r, col, val, orig) {
    if (this.o.onEdit) this.o.onEdit(r, col, val, orig);
    else if (col.set) col.set(r, val); else r[col.key] = val;
  }
  refresh() { this.applyView(); }
  destroy() { this.ro.disconnect(); }
}
