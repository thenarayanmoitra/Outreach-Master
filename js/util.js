/* =============================================================================
   Reach — shared utilities (DOM, formatting, files)
   Classic script, no modules: works from file://, Netlify, or the tiny serve.js
   ============================================================================= */
'use strict';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => (Number(n) || 0).toLocaleString('en-GB');
const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : (many || one + 's')}`;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; }
function pad2(n) { return String(n).padStart(2, '0'); }
function isoOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayISO() { return isoOf(new Date()); }
function nowISO() { return new Date().toISOString(); }
function stamp() { return todayISO().replace(/-/g, ''); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseDate(d) {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d) ? null : d;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const dt = new Date(s); return isNaN(dt) ? null : dt; }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const dt = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(dt) ? null : dt; }
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);           // dd/mm/yyyy
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; const dt = new Date(y, +m[2] - 1, +m[1]); return isNaN(dt) ? null : dt; }
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}
function toISODate(d) { const dt = parseDate(d); return dt ? isoOf(dt) : ''; }
function fmtDate(d) {
  const dt = parseDate(d);
  if (!dt) return d ? String(d) : '—';
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function fmtDateTime(d) {
  const dt = parseDate(d);
  if (!dt) return '—';
  return `${fmtDate(dt)}, ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}
function daysBetween(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}
function relTime(d) {
  const dt = parseDate(d);
  if (!dt) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d).trim())) { const n = daysBetween(d, todayISO()); if (n === 0) return 'today'; if (n === 1) return 'yesterday'; if (n > 1 && n < 30) return `${n} days ago`; if (n < 0) return `in ${-n} days`; return fmtDate(dt); }
  const diff = (Date.now() - dt.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return fmtDate(dt);
}
function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
function uniq(arr) { return [...new Set(arr)]; }
function by(key, dir = 1) { return (a, b) => { const x = a[key], y = b[key]; return (x > y ? 1 : x < y ? -1 : 0) * dir; }; }
function deepClone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|\s|-)([a-z])/g, (m, p, c) => p + c.toUpperCase()); }
function bytesFmt(n) { if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }

/* Yield a frame through a MessageChannel: keeps long loops from freezing the page. */
const _yc = (typeof MessageChannel !== 'undefined') ? new MessageChannel() : null;
const _yq = [];
if (_yc) _yc.port1.onmessage = () => { const r = _yq.shift(); if (r) r(); };
function yieldToPaint() { return new Promise(res => { if (_yc) { _yq.push(res); _yc.port2.postMessage(0); } else setTimeout(res, 0); }); }

/* ============================= ICONS ============================= */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  shield: '<path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5v-2z"/><path d="M8 7h8M8 11h6"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>',
  mailx: '<path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8"/><path d="m3 7 9 6 9-6"/><path d="m17 17 4 4m0-4-4 4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  chevronL: '<path d="m15 18-6-6 6-6"/>',
  chevronR: '<path d="m9 18 6-6-6-6"/>',
  chevronD: '<path d="m6 9 6 6 6-6"/>',
  arrowR: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.5 3.8 3.8 0 0 0 6 19z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  users: '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sparkle: '<path d="m12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10 10 0 0 1 12 19c-7 0-11-7-11-7a18 18 0 0 1 5.1-5.9M9.9 4.2A9.5 9.5 0 0 1 12 4c7 0 11 7 11 7a18 18 0 0 1-2.2 3.2"/><path d="m1 1 22 22"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  merge: '<path d="M6 3v6a6 6 0 0 0 6 6 6 6 0 0 1 6 6"/><path d="M18 3v6a6 6 0 0 1-6 6"/><path d="m9 6-3-3-3 3M21 6l-3-3-3 3"/>',
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 9v12"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M12.5 4.5c3-3 7-3 7-3s0 4-3 7l-5 5-4-4z"/><path d="m9 10-4 1 2 2M14 15l-1 4 2-2"/><circle cx="15" cy="9" r="1.2"/>',
};
function icon(name, cls = '') { return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }

/* ============================= FILES =============================
   Tables are { headers:[], rows:[{ n, cells:[] }], name, fileName }.
   Cell values are kept as text exactly as the sheet shows them, so
   "00123" stays "00123" and long numbers keep every digit. */
function readFileAsArray(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
}
function readFileAsText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
}
async function readBook(file) {
  const name = file.name || 'list';
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = await readFileAsText(file);
    return { fileName: name, sheets: { Sheet1: tableFromText(text, name) } };
  }
  if (typeof XLSX === 'undefined') throw new Error('Spreadsheet reader not loaded. Open the app through serve.js or a web server.');
  const buf = await readFileAsArray(file);
  const book = XLSX.read(buf, { type: 'array', cellDates: true, raw: false, dense: false });
  const sheets = {};
  for (const sn of book.SheetNames) {
    const ws = book.Sheets[sn];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    sheets[sn] = tableFromAOA(aoa, sn, name);
  }
  return { fileName: name, sheets };
}
function tableFromAOA(aoa, sheetName = 'Sheet1', fileName = '') {
  const clean = aoa.map(r => (r || []).map(v => v == null ? '' : String(v)));
  // header = first row with at least two non-empty cells (sheets often start with a title row)
  let hi = clean.findIndex(r => r.filter(c => c.trim()).length >= 2);
  if (hi < 0) hi = 0;
  const headers = (clean[hi] || []).map((h, i) => h.trim() || `Column ${i + 1}`);
  const width = Math.max(headers.length, ...clean.map(r => r.length));
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  const rows = [];
  for (let i = hi + 1; i < clean.length; i++) {
    const cells = clean[i].slice();
    while (cells.length < width) cells.push('');
    if (!cells.some(c => c.trim())) continue;
    rows.push({ n: i + 1, cells });   // n = 1-based row number in the sheet
  }
  return { name: sheetName, fileName, headers, rows };
}
/* CSV / TSV parser that respects quotes and newlines inside cells. */
function parseDelimited(text, delim) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* ignore */ }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function detectDelimiter(text) {
  const head = String(text || '').split(/\r?\n/).slice(0, 10).join('\n');
  const counts = { '\t': (head.match(/\t/g) || []).length, ',': (head.match(/,/g) || []).length, ';': (head.match(/;/g) || []).length };
  if (counts['\t'] > 0) return '\t';
  return counts[';'] > counts[','] ? ';' : ',';
}
function tableFromText(text, fileName = 'Pasted') {
  const delim = detectDelimiter(text);
  const aoa = parseDelimited(text, delim);
  if (aoa.length === 1 || (aoa.length && aoa.every(r => r.length === 1))) {
    // A bare list (one value per line): synthesise a header
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return { name: 'Pasted', fileName, headers: ['Email'], rows: lines.map((l, i) => ({ n: i + 1, cells: [l] })) };
  }
  return tableFromAOA(aoa, 'Pasted', fileName);
}
function aoaFromTable(table, rows, { extraHeaders = [], extraCells = null } = {}) {
  const out = [[...table.headers, ...extraHeaders]];
  for (const k of rows) {
    const cells = k.row.cells.slice();
    if (k.overrides) for (const [i, v] of k.overrides) cells[i] = v;
    out.push([...cells, ...((extraCells && extraCells(k)) || [])]);
  }
  return out;
}
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function downloadText(name, text, mime = 'text/plain;charset=utf-8') { downloadBlob(name, new Blob([text], { type: mime })); }
function csvFromAOA(aoa) {
  return aoa.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
}
function writeAOA({ aoa, format = 'xlsx', fileName = 'list', sheetName = 'Sheet1' }) {
  const safe = safeName(fileName);
  if (format === 'csv' || typeof XLSX === 'undefined') { downloadText(safe + '.csv', '﻿' + csvFromAOA(aoa), 'text/csv;charset=utf-8'); return safe + '.csv'; }
  const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => r.map(v => v == null ? '' : v)));
  // keep every cell as text so phone numbers, ids and zero-padded values survive
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = range.s.r; R <= range.e.r; R++) for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
    if (cell && cell.t === 'n' && typeof cell.v === 'number' && !Number.isSafeInteger(cell.v)) { cell.t = 's'; cell.v = String(cell.v); }
  }
  ws['!cols'] = aoa[0].map((h, i) => ({ wch: Math.min(48, Math.max(10, ...aoa.slice(0, 200).map(r => String(r[i] || '').length + 2))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30));
  XLSX.writeFile(wb, safe + '.xlsx');
  return safe + '.xlsx';
}
function safeName(s) { return String(s || 'List').replace(/\.(xlsx|xls|csv|tsv|txt)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 90) || 'List'; }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch (e2) { return false; } finally { ta.remove(); }
  }
}
function readTextFile(file) { return readFileAsText(file); }
