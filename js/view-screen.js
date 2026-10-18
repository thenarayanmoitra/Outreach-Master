/* =============================================================================
   Reach — Screen a list: drop a sheet, see who you already know, download the
   clean list, then press "I sent this list".
   ============================================================================= */
'use strict';

const ScreenView = {
  s: null, grid: null,
  reset() { this.s = { stage: 'upload', book: null, table: null, map: null, items: [], counts: null, filter: 'all', name: '', date: todayISO(), format: Store.state.settings.exportFormat || 'xlsx', sent: null, pasteOpen: false }; this.grid = null; },
  render(root, sub) {
    if (!this.s) this.reset();
    if (sub === 'new') { this.reset(); App.go('screen'); return; }
    if (this.s.stage === 'review') return this.renderReview(root);
    root.dataset.tab = 'upload';
    const camps = Store.state.campaigns.slice(0, 5);
    root.innerHTML = pageHead({ eyebrow: 'Before you send', title: 'Screen a list', lede: 'Drop the sheet you are about to send. Reach checks every address against your memory — clients, replies, bounces, same company, already mailed — and hands back a clean list with the same columns.' }) + `
      <div class="two-col">
        <div class="stack">
          <div class="card card-pad">${dropzoneHtml({ title: 'Drop your .xlsx or .csv here', text: 'or click to choose a file · Google Sheets: File → Download → .csv' })}
            <div class="row mt-3 wrap"><button class="btn btn-ghost btn-sm" data-paste-toggle>${icon('paste', 'ic-sm')}Paste cells from Google Sheets instead</button><span class="small muted">Nothing is saved when you screen. Only “I sent this list” writes to memory.</span></div>
            <div id="paste-box" ${this.s.pasteOpen ? '' : 'hidden'} class="mt-2"><textarea class="textarea paste mono" id="paste-text" placeholder="Select the cells in Google Sheets (header row included), copy, and paste here"></textarea><div class="row mt-2"><button class="btn btn-primary btn-sm" data-paste-run>${icon('shield', 'ic-sm')}Screen pasted rows</button></div></div>
          </div>
          <div class="card card-pad"><h3 style="font-size:.95rem">What gets flagged</h3><div class="small muted mt-1">First match wins, strongest rule decides. Change any of this in <a href="#/settings/rules">Settings → Rules</a>.</div>
            <div class="grid-2 mt-3" style="gap:.5rem">${[['ban', 'Blocked', 'Clients, warm leads, pipeline, not-now, do-not-contact, hard bounces, duplicates and rows without a valid email. Left out of the clean list.', 'var(--red)'], ['alert', 'Your call', 'Same company domain or name as someone you know, same contact name, mailed before, soft bounces. Left out unless you tick them.', 'var(--amber)'], ['check', 'Ready', 'Nothing in your memory. In the clean list.', 'var(--green)'], ['info', 'Notes', 'Role mailboxes (info@, sales@) and free mailboxes are pointed out but not held back.', 'var(--grey)']].map(([ic, t, d, c]) => `<div class="row" style="align-items:flex-start;gap:.6rem"><span class="pill" style="--c:${c};margin-top:2px">${icon(ic)}${t}</span><span class="small muted">${d}</span></div>`).join('')}</div></div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><h3>Your memory</h3><a class="small" href="#/sheets">Open sheets</a></div><div class="card-pad" style="padding-top:.6rem">${this.memorySummary()}</div></div>
          ${camps.length ? `<div class="card"><div class="card-head"><h3>Recent screenings</h3><a class="small" href="#/sheets/campaigns">All</a></div><div class="card-pad" style="padding-top:.4rem"><div class="list-rows">${camps.map(c => `<div class="list-row"><span class="grow clip"><b>${esc(c.name)}</b><div class="tiny muted">${fmtDate(c.date)} · ${fmtN(c.sent)} sent · ${fmtN(c.block)} blocked</div></span></div>`).join('')}</div></div></div>` : ''}
        </div>
      </div>`;
    wireDropzone($('.dropzone', root), files => this.loadFiles(files));
    $('[data-paste-toggle]', root).onclick = () => { this.s.pasteOpen = !this.s.pasteOpen; $('#paste-box', root).hidden = !this.s.pasteOpen; if (this.s.pasteOpen) $('#paste-text', root).focus(); };
    $('[data-paste-run]', root).onclick = () => { const t = $('#paste-text', root).value; if (!t.trim()) return toast('Paste something first.', 'warn'); this.loadBook({ fileName: 'Pasted list', sheets: { Pasted: tableFromText(t, 'Pasted list') } }); };
    $('#paste-text', root).addEventListener('paste', () => setTimeout(() => { const t = $('#paste-text', root).value; if (t.trim().split('\n').length > 1) this.loadBook({ fileName: 'Pasted list', sheets: { Pasted: tableFromText(t, 'Pasted list') } }); }, 0));
  },
  memorySummary() {
    const s = Store.state, by = {}; for (const p of s.people) by[p.status] = (by[p.status] || 0) + 1;
    return `<div class="kv">${STATUS_KEYS.map(k => `<dt>${statusChip(k, { sm: true })}</dt><dd class="num">${fmtN(by[k] || 0)}</dd>`).join('')}<dt><span class="pill" style="--c:var(--red)">${icon('mailx')}Bounced</span></dt><dd class="num">${fmtN(s.bounces.length)}</dd><dt><span class="pill" style="--c:var(--blue)">${icon('send')}Mailed</span></dt><dd class="num">${fmtN(s.ledger.length)}</dd></div>`;
  },
  async loadFiles(files) {
    try { const book = await readBook(files[0]); this.loadBook(book); } catch (e) { toastErr(e, 'Could not read that file.'); }
  },
  loadBook(book) {
    const names = Object.keys(book.sheets).filter(n => book.sheets[n].rows.length);
    if (!names.length) return toast('That file has no rows.', 'warn');
    this.s.book = book;
    if (names.length === 1) return this.useSheet(names[0]);
    const m = openModal({ title: 'Which sheet?', size: 'sm', body: `<div class="list-rows">${names.map(n => `<button class="list-row click" data-sheet="${esc(n)}"><span class="grow"><b>${esc(n)}</b></span><span class="muted small">${plural(book.sheets[n].rows.length, 'row')}</span></button>`).join('')}</div>` });
    $$('[data-sheet]', m).forEach(b => b.onclick = () => { closeModal(m); this.useSheet(b.dataset.sheet); });
  },
  useSheet(name) {
    const s = this.s; s.table = s.book.sheets[name]; s.map = guessColumns(s.table); s.name = safeName(s.book.fileName === 'Pasted list' ? `List ${fmtDate(todayISO())}` : s.book.fileName);
    if (s.map.email < 0) { toast('Reach could not find an email column. Pick it below.', 'warn'); this.mappingModal(true); }
    else this.run();
  },
  mappingModal(force = false) {
    const s = this.s, H = s.table.headers;
    const opt = (sel, none) => `<option value="-1">${none}</option>` + H.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h)}</option>`).join('');
    const m = openModal({ title: 'Columns', size: 'lg', sub: `${esc(s.book.fileName)} · ${esc(s.table.name)} · ${plural(s.table.rows.length, 'row')}`, dismissable: !force, body: `
      <div class="mapping">
        <div class="field"><label>Email <span style="color:var(--red)">*</span></label><select class="select sm" data-m="email">${opt(s.map.email, '— pick —')}</select></div>
        <div class="field"><label>Company</label><select class="select sm" data-m="company">${opt(s.map.company, '— none —')}</select></div>
        <div class="field"><label>Contact name</label><select class="select sm" data-m="name">${opt(s.map.name, '— none —')}</select></div>
        <div class="field"><label>Last name <span class="muted">(if separate)</span></label><select class="select sm" data-m="last">${opt(s.map.last, '— none —')}</select></div>
        <div class="field"><label>Website <span class="muted">(for domain matching)</span></label><select class="select sm" data-m="website">${opt(s.map.website, '— none —')}</select></div>
      </div>
      <div class="table-wrap mt-3" style="max-height:34vh"><table class="table preview-table"><thead><tr><th>#</th>${H.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.slice(0, 6).map(r => `<tr><td class="muted">${r.n}</td>${r.cells.map(c => `<td title="${esc(c)}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      foot: `${force ? '<button class="btn btn-quiet" data-back>Choose another file</button>' : '<button class="btn btn-quiet" data-cancel>Cancel</button>'}<button class="btn btn-primary" data-ok>Screen ${fmtN(s.table.rows.length)} rows</button>` });
    $$('[data-m]', m).forEach(sel => sel.onchange = () => { s.map[sel.dataset.m] = +sel.value; });
    $('[data-ok]', m).onclick = () => { if (s.map.email < 0) return toast('Pick the email column.', 'warn'); closeModal(m); this.run(); };
    const c = $('[data-cancel]', m); if (c) c.onclick = () => closeModal(m);
    const b = $('[data-back]', m); if (b) b.onclick = () => { closeModal(m); this.reset(); App.rerender(); };
  },
  async run() {
    const s = this.s;
    const p = startProgress().step('Reading the sheet', `${plural(s.table.rows.length, 'row')} in ${s.book.fileName}`, 0);
    await yieldToPaint();
    try {
      s.items = itemsFromTable(s.table, s.map);
      p.step('Checking your memory', `${plural(s.items.length, 'address', 'addresses')} against ${fmtN(Store.state.people.length)} people, ${fmtN(Store.state.bounces.length)} bounces and ${fmtN(Store.state.ledger.length)} mailed addresses. Nothing is saved.`, 0);
      await yieldToPaint();
      this.rescreen();
      s.stage = 'review'; s.filter = 'all'; s.sent = null;
    } finally { p.close(); }
    this.grid = null;
    App.rerender();
  },
  rescreen() {
    const s = this.s;
    if (s.sent) { s.counts = screenCounts(s.items); return; }   // verdicts are frozen once the list is sent
    const keep = new Map(s.items.map(it => [it.i, { include: it.include, forced: it.forced, verdict: it.verdict }]));
    screenItems(s.items, Store.getIndex(), Store.state.settings);
    for (const it of s.items) { const k = keep.get(it.i); if (k && k.forced && it.verdict === k.verdict) { it.forced = true; it.include = true; } else if (k && it.verdict === 'ask' && k.verdict === 'ask') it.include = k.include; }
    s.counts = screenCounts(s.items);
  },
  /* ---------- review ---------- */
  renderReview(root) {
    const s = this.s;
    if (root.dataset.tab === 'review' && this.grid && this.grid.el.isConnected) { this.rescreen(); this.updateReview(root); return; }
    root.dataset.tab = 'review';
    root.innerHTML = `
      <div class="row wrap mb-3" style="gap:.6rem">
        <button class="btn btn-quiet btn-sm" data-restart>${icon('chevronL', 'ic-sm')}Another list</button>
        <span class="small"><b>${esc(s.book.fileName)}</b>${Object.keys(s.book.sheets).length > 1 ? ` · ${esc(s.table.name)}` : ''} · ${plural(s.table.rows.length, 'row')} · ${plural(s.items.length, 'address', 'addresses')}</span>
        <span class="small muted">Columns: email <b>${esc(s.table.headers[s.map.email] || '?')}</b>${s.map.company > -1 ? `, company <b>${esc(s.table.headers[s.map.company])}</b>` : ''}${s.map.name > -1 ? `, name <b>${esc(s.table.headers[s.map.name])}</b>` : ''}</span>
        <button class="btn btn-quiet btn-xs" data-cols>Change</button>
      </div>
      <div id="rv-summary"></div>
      <div class="verdict-stats" id="rv-stats"></div>
      <div class="two-col mt-3"><div id="rv-grid"></div><div class="sticky-side" id="rv-side"></div></div>`;
    $('[data-restart]', root).onclick = async () => { if (s.sent || await uiConfirm({ title: 'Screen another list?', message: 'This screening is discarded. Nothing has been saved to memory unless you pressed “I sent this list”.', confirmLabel: 'Another list' })) { this.reset(); App.rerender(); } };
    $('[data-cols]', root).onclick = () => this.mappingModal(false);
    this.buildGrid($('#rv-grid', root));
    $('#rv-summary', root).addEventListener('click', e => { const b = e.target.closest('[data-open-person]'); if (b) PeopleUI.open(b.dataset.openPerson); });
    this.updateReview(root);
  },
  updateReview(root) {
    const s = this.s;
    $('#rv-summary', root).innerHTML = this.summaryHtml();
    $('#rv-stats', root).innerHTML = this.statsHtml();
    $$('[data-filter]', $('#rv-stats', root)).forEach(b => b.onclick = () => { s.filter = b.dataset.filter; this.grid.applyView(); this.updateReview(root); });
    $('#rv-side', root).innerHTML = this.sideHtml();
    this.wireSide($('#rv-side', root));
    this.grid.setRows(s.items);
  },
  summaryHtml() {
    const s = this.s, c = s.counts, name = Store.state.settings.name || 'there';
    const known = s.items.filter(it => it.valid && !it.dupOf && it.reasons.some(r => ['person', 'bounced', 'mailed'].includes(r.key)));
    const matched = s.items.filter(it => it.valid && !it.dupOf && it.matches.length && !it.reasons.some(r => r.key === 'person'));
    const people = new Map(); for (const it of known) for (const r of it.reasons) if (r.person) people.set(r.person.id, r.person);
    const bounced = known.filter(it => it.reasons.some(r => r.key === 'bounced')).length;
    const mailedOnly = known.filter(it => it.reasons.every(r => r.key !== 'person' && r.key !== 'bounced') && it.reasons.some(r => r.key === 'mailed')).length;
    let head, body;
    if (!known.length && !matched.length) { head = `${esc(name)}, this list is clean.`; body = `None of these ${plural(c.all, 'address', 'addresses')} is in your memory. <b>${fmtN(c.ready)}</b> are ready to send${c.block ? `; ${fmtN(c.block)} are held back for other reasons (duplicates or no valid email)` : ''}.`; }
    else {
      head = `${esc(name)}, you already know ${fmtN(known.length + matched.length)} of these ${fmtN(c.all)}.`;
      const parts = [];
      if (people.size) parts.push(`<b>${fmtN(known.filter(it => it.reasons.some(r => r.key === 'person')).length)}</b> ${people.size === 1 ? 'is' : 'are'} in your memory (${[...people.values()].slice(0, 3).map(p => `${esc(personLabel(p))} · ${STATUSES[p.status]?.label.toLowerCase()}`).join(', ')}${people.size > 3 ? `, +${people.size - 3} more` : ''})`);
      if (bounced) parts.push(`<b>${fmtN(bounced)}</b> bounced before`);
      if (mailedOnly) parts.push(`<b>${fmtN(mailedOnly)}</b> ${mailedOnly === 1 ? 'was' : 'were'} already mailed`);
      if (matched.length) parts.push(`<b>${fmtN(matched.length)}</b> share a company, domain or name with someone you know`);
      body = parts.join(' · ') + `. <b>${fmtN(c.ready)}</b> ready, <b>${fmtN(c.ask)}</b> your call, <b>${fmtN(c.block)}</b> blocked.`;
    }
    const chips = [...people.values()].slice(0, 14).map(p => `<button class="chip btn-chip" data-open-person="${p.id}"><i class="dot" style="background:${STATUSES[p.status]?.color}"></i>${esc(personLabel(p))}</button>`).join('');
    return `<div class="summary-card"><h2>${head}</h2><p>${body}</p>${chips ? `<div class="names">${chips}${people.size > 14 ? `<span class="chip">+${people.size - 14} more</span>` : ''}</div>` : ''}</div>`;
  },
  statsHtml() {
    const s = this.s, c = s.counts, f = s.filter;
    const tiles = [['all', 'All', c.all, 'var(--text)'], ['ready', 'Ready', c.ready, 'var(--green)'], ['ask', 'Your call', c.ask, 'var(--amber)'], ['block', 'Blocked', c.block, 'var(--red)']];
    const reasons = Object.keys(REASONS).filter(k => c[k]).map(k => `<button class="vs ${f === k ? 'active' : ''}" data-filter="${k}" style="--c:${REASONS[k].color}"><div class="v">${fmtN(c[k])}</div><div class="l">${esc(REASONS[k].label)}</div></button>`).join('');
    return tiles.map(([k, l, v, col]) => `<button class="vs ${f === k ? 'active' : ''}" data-filter="${k}" style="--c:${col}"><div class="v">${fmtN(v)}</div><div class="l">${l}</div></button>`).join('') + reasons;
  },
  buildGrid(mount) {
    const s = this.s;
    const title = it => { const cells = it.row.cells; const main = s.map.company > -1 && cells[s.map.company] ? cells[s.map.company] : (it.name || cells.find((v, i) => i !== s.map.email && String(v).trim()) || ''); return main; };
    this.grid = new Grid({
      storageKey: 'screen', rows: s.items, getId: it => it.i, rowHeight: 44, maxHeight: 'calc(100vh - 250px)', searchPlaceholder: 'Search rows…',
      searchText: it => `${it.row.cells.join(' ')} ${it.email} ${it.reasons.map(r => r.text).join(' ')}`,
      filter: it => s.filter === 'all' ? true : (['ready', 'ask', 'block'].includes(s.filter) ? it.verdict === s.filter : it.reasons.some(r => r.key === s.filter)),
      rowClass: it => `rv-row ${it.verdict} ${it.forced ? 'forced' : ''}`,
      columns: [
        { key: 'include', label: 'Send', width: '58px', nosort: true, render: it => `<input type="checkbox" data-chk ${it.include ? 'checked' : ''} ${it.verdict === 'block' && !it.forced ? 'disabled title="Blocked — open the row to override"' : ''} ${!it.valid ? 'disabled' : ''} aria-label="Include">`, set: (it, v) => { it.include = !!v; }, editable: false },
        { key: 'verdict', label: 'Verdict', width: '112px', render: it => verdictBadge(it.verdict), sortVal: it => VERDICT[it.verdict === 'ready' ? 'none' : it.verdict] },
        { key: 'n', label: '#', width: '58px', align: 'right', get: it => it.row.n, render: it => `<span class="muted num">${it.row.n}</span>` },
        { key: 'who', label: 'Row', width: 'minmax(170px,240px)', get: it => title(it), render: it => `<span class="clip"><b>${esc(title(it)) || '<span class="muted">—</span>'}</b>${it.name && s.map.company > -1 ? `<span class="cell-sub">${esc(it.name)}</span>` : ''}</span>` },
        { key: 'email', label: 'Email', width: 'minmax(190px,260px)', get: it => it.email || it.raw, render: it => `<span class="clip ${it.valid ? '' : 'muted'}" title="${esc(it.email || it.raw)}">${esc(it.email || it.raw || '—')}</span>` },
        { key: 'why', label: 'Why', width: 'minmax(260px,1fr)', nosort: true, render: it => this.whyHtml(it) },
        { key: '_open', width: '36px' },
      ],
      onEdit: (it, col, val) => { if (col.key === 'include') { it.include = !!val; s.counts = screenCounts(s.items); this.updateSideCounts(); } },
      onOpen: it => this.openItem(it),
      empty: 'No rows match this filter.',
    });
    this.grid.slot.innerHTML = `<button class="btn btn-ghost btn-xs" data-inc-ask>${icon('check', 'ic-sm')}Include all “your call”</button><button class="btn btn-ghost btn-xs" data-exc-ask>${icon('x', 'ic-sm')}Exclude all “your call”</button>`;
    $('[data-inc-ask]', this.grid.slot).onclick = () => { for (const it of s.items) if (it.verdict === 'ask') it.include = true; s.counts = screenCounts(s.items); this.grid.refresh(); this.updateSideCounts(); };
    $('[data-exc-ask]', this.grid.slot).onclick = () => { for (const it of s.items) if (it.verdict === 'ask') it.include = false; s.counts = screenCounts(s.items); this.grid.refresh(); this.updateSideCounts(); };
    mount.innerHTML = ''; mount.appendChild(this.grid.el);
  },
  whyHtml(it) {
    if (!it.reasons.length) return '<span class="small muted">Not in your memory</span>';
    const strong = it.reasons.filter(r => r.level !== 'allow'), soft = it.reasons.filter(r => r.level === 'allow');
    const first = strong[0] || soft[0];
    return `<div class="why clip"><span class="row gap-1" style="white-space:nowrap">${reasonPill(first.key)}<span class="clip">${esc(first.text)}</span></span>${it.reasons.length > 1 ? `<span class="row gap-1">${it.reasons.slice(1, 4).map(r => reasonPill(r.key)).join('')}${it.reasons.length > 4 ? `<span class="tiny muted">+${it.reasons.length - 4}</span>` : ''}</span>` : ''}</div>`;
  },
  openItem(it) {
    const s = this.s;
    const d = openDrawer({ title: it.email || it.raw || `Row ${it.row.n}`, sub: `${verdictBadge(it.verdict)} <span class="muted">· row ${it.row.n} of ${esc(s.book.fileName)}</span>`, body: `
      <div class="section" style="margin-top:0"><h4>Why</h4>${it.reasons.length ? `<div class="list-rows">${it.reasons.map(r => `<div class="list-row" style="align-items:flex-start">${reasonPill(r.key)}<span class="grow small">${esc(r.text)}</span>${r.person ? `<button class="btn btn-ghost btn-xs" data-open-person="${r.person.id}">Open</button>` : ''}</div>`).join('')}</div>` : '<div class="small muted">Nothing in your memory matches this address, company or name.</div>'}</div>
      <div class="section"><h4>In the clean list?</h4>
        ${it.valid ? `<label class="toggle"><input type="checkbox" data-inc ${it.include ? 'checked' : ''}><span class="tg"></span><span>${it.verdict === 'block' ? 'Send anyway (override the block)' : 'Include this address'}</span></label>${it.verdict === 'block' ? '<div class="callout warn mt-2 small">' + icon('alert') + '<div>Overriding means mailing someone your memory says you should not. Only do this if you are sure.</div></div>' : ''}` : '<div class="small muted">No valid email, so it cannot be sent.</div>'}</div>
      <div class="section"><h4>This row</h4><dl class="kv">${s.table.headers.map((h, i) => `<dt>${esc(h)}</dt><dd>${esc(it.row.cells[i]) || '<span class="muted">—</span>'}</dd>`).join('')}</dl></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-add>${icon('plus', 'ic-sm')}Add to memory</button><button class="btn btn-ghost btn-sm" data-bounce>${icon('mailx', 'ic-sm')}Mark bounced</button>` });
    const inc = $('[data-inc]', d); if (inc) inc.onchange = () => { it.include = inc.checked; it.forced = it.verdict === 'block' && inc.checked; s.counts = screenCounts(s.items); this.grid.refresh(); this.updateSideCounts(); };
    $$('[data-open-person]', d).forEach(b => b.onclick = () => PeopleUI.open(b.dataset.openPerson));
    $('[data-add]', d).onclick = () => { closeDrawer(); PeopleUI.quickAdd({ status: 'dnc', email: it.email, company: it.company, name: it.name }); };
    $('[data-bounce]', d).onclick = async () => { if (!it.valid) return; const tx = Store.begin(['bounces']); Store.addBounces([{ email: it.email, type: 'hard' }], { source: 'manual' }); await Store.commit(tx, { label: `Marked ${it.email} as bounced`, type: 'bounce' }); closeDrawer(); toast(`${it.email} is now blocked as bounced.`); };
  },
  /* ---------- side panel ---------- */
  plan() { const s = this.s; return s.items.filter(it => it.include && it.valid); },
  sideHtml() {
    const s = this.s, keep = this.plan();
    if (s.sent) return `<div class="card card-pad"><div class="row gap-2"><span class="avatar" style="background:var(--green-bg);color:var(--green)">${icon('check')}</span><div><b>Remembered.</b><div class="small muted">${fmtN(s.sent.count)} addresses saved as mailed on ${fmtDate(s.sent.date)} under <b>${esc(s.sent.name)}</b>.</div></div></div>
      <div class="sep"></div><div class="small">Next: when bounces come back, paste them in <a href="#/bounces">Bounces</a> and attach them to this campaign. When someone replies, <a href="#" data-reply>log the reply</a>.</div>
      <div class="row mt-3 wrap"><button class="btn btn-quiet btn-sm" data-undo-sent>${icon('undo', 'ic-sm')}Undo</button><button class="btn btn-ghost btn-sm" data-dl="clean">${icon('download', 'ic-sm')}Clean list again</button><button class="btn btn-primary btn-sm" data-another>Another list</button></div></div>`;
    return `<div class="card"><div class="card-head"><h3>Clean list</h3><span class="chip" style="--c:var(--green);--c-bg:var(--green-bg)" id="side-count">${fmtN(keep.length)} rows</span></div>
      <div class="card-pad" style="padding-top:.8rem"><div class="form-grid">
        <div class="field full"><label>Campaign name</label><input class="input sm" id="camp-name" value="${esc(s.name)}"></div>
        <div class="field"><label>Send date</label><input class="input sm" type="date" id="camp-date" value="${s.date}"></div>
        <div class="field"><label>Format</label><div class="seg sm"><button class="${s.format === 'xlsx' ? 'active' : ''}" data-fmt="xlsx">.xlsx</button><button class="${s.format === 'csv' ? 'active' : ''}" data-fmt="csv">.csv</button></div></div>
      </div>
      <div class="col mt-3" style="gap:.4rem">
        <button class="btn btn-primary" data-dl="clean" ${keep.length ? '' : 'disabled'}>${icon('download')}Download clean list</button>
        <button class="btn btn-ghost btn-sm" data-dl="left">${icon('file', 'ic-sm')}Left-out rows, with reasons</button>
        <button class="btn btn-ghost btn-sm" data-dl="all">${icon('sheet', 'ic-sm')}Whole sheet, annotated</button>
        <button class="btn btn-ghost btn-sm" data-copy>${icon('copy', 'ic-sm')}Copy <span id="copy-n">${fmtN(keep.length)}</span> emails</button>
      </div>
      <div class="tiny muted mt-2">Same columns, same order, same values. A cell with two good addresses becomes two rows.</div></div>
      <div class="card-foot" style="flex-direction:column;align-items:stretch;gap:.4rem"><div class="small"><b>After sending</b> <span class="muted">— so the next list is checked against these too.</span></div><button class="btn btn-accent" data-sent ${keep.length ? '' : 'disabled'}>${icon('send')}I sent this list</button></div></div>`;
  },
  updateSideCounts() { const n = this.plan().length; const c = $('#side-count'); if (c) c.textContent = `${fmtN(n)} rows`; const cp = $('#copy-n'); if (cp) cp.textContent = fmtN(n); const dl = $('[data-dl="clean"]'); if (dl) dl.disabled = !n; const st = $('[data-sent]'); if (st) st.disabled = !n; },
  wireSide(side) {
    const s = this.s;
    const nameInp = $('#camp-name', side); if (nameInp) nameInp.oninput = () => { s.name = nameInp.value; };
    const dateInp = $('#camp-date', side); if (dateInp) dateInp.onchange = () => { s.date = dateInp.value || todayISO(); };
    $$('[data-fmt]', side).forEach(b => b.onclick = () => { s.format = b.dataset.fmt; $$('[data-fmt]', side).forEach(x => x.classList.toggle('active', x === b)); });
    $$('[data-dl]', side).forEach(b => b.onclick = () => this.download(b.dataset.dl));
    const cp = $('[data-copy]', side); if (cp) cp.onclick = async () => { const list = uniq(this.plan().map(it => it.email)); await copyText(list.join('\n')); toast(`Copied ${plural(list.length, 'address', 'addresses')} — one per line.`); };
    const st = $('[data-sent]', side); if (st) st.onclick = () => this.markSent();
    const u = $('[data-undo-sent]', side); if (u) u.onclick = () => this.undoSent();
    const a = $('[data-another]', side); if (a) a.onclick = () => { this.reset(); App.rerender(); };
    const r = $('[data-reply]', side); if (r) r.onclick = e => { e.preventDefault(); PeopleUI.logReply({ campaignId: s.sent.campaignId }); };
  },
  download(kind) {
    const s = this.s, t = s.table;
    let rows, extraHeaders = [], extraCells = null, suffix = '';
    const reasonText = it => it.reasons.map(r => r.text).join(' | ');
    if (kind === 'clean') { rows = this.plan().map(it => ({ row: it.row, overrides: new Map([[s.map.email, it.email]]) })); suffix = 'clean'; if (!rows.length) return toast('Nothing to download: no rows are included.', 'warn'); }
    else if (kind === 'left') { rows = s.items.filter(it => !(it.include && it.valid)).map(it => ({ row: it.row, overrides: new Map([[s.map.email, it.email || it.raw]]), it })); extraHeaders = ['Reach verdict', 'Reason']; extraCells = k => [k.it.verdict === 'ready' ? 'Excluded by you' : k.it.verdict === 'ask' ? 'Your call (left out)' : 'Blocked', reasonText(k.it)]; suffix = 'left out'; if (!rows.length) return toast('Nothing was left out.', 'ok'); }
    else { rows = s.items.map(it => ({ row: it.row, overrides: new Map([[s.map.email, it.email || it.raw]]), it })); extraHeaders = ['Reach verdict', 'In clean list', 'Reason']; extraCells = k => [k.it.verdict === 'ready' ? 'Ready' : k.it.verdict === 'ask' ? 'Your call' : 'Blocked', k.it.include && k.it.valid ? 'Yes' : 'No', reasonText(k.it)]; suffix = 'annotated'; }
    const aoa = aoaFromTable(t, rows, { extraHeaders, extraCells });
    const name = writeAOA({ aoa, format: s.format, fileName: `${s.name || 'List'} — ${suffix} ${stamp()}`, sheetName: t.name });
    toast(`Downloaded ${name} (${plural(rows.length, 'row')}).`);
  },
  async markSent() {
    const s = this.s, keep = this.plan(), emails = uniq(keep.map(it => it.email));
    const forced = keep.filter(it => it.forced).length;
    const ok = await uiConfirm({ title: 'Remember these as mailed?', message: `<b>${fmtN(emails.length)}</b> addresses will be saved as mailed on <b>${fmtDate(s.date)}</b> under the campaign <b>${esc(s.name || 'Untitled')}</b>. Only the bare addresses and the date are stored — no names or notes.${forced ? `<br><br><span style="color:var(--red)">${forced} blocked ${forced === 1 ? 'row was' : 'rows were'} overridden.</span>` : ''}`, confirmLabel: 'Yes, I sent it' });
    if (!ok) return;
    const tx = Store.begin(['ledger', 'campaigns', 'people']);
    const c = Store.addCampaign({ name: s.name || `List ${fmtDate(s.date)}`, date: s.date, file: s.book.fileName, rows: s.table.rows.length, ready: s.counts.ready, ask: s.counts.ask, block: s.counts.block, sent: emails.length });
    Store.rememberSent(emails, { campaignId: c.id, date: s.date });
    for (const it of keep) { const p = Store.getIndex().byEmail.get(it.email); if (p) Store.updatePerson(p.id, { last_contact: s.date }, `Mailed in ${c.name}`); }
    await Store.commit(tx, { label: `Sent ${c.name}`, type: 'sent', text: `Sent “${c.name}”: ${fmtN(emails.length)} addresses remembered as mailed on ${fmtDate(s.date)}.` });
    s.sent = { count: emails.length, date: s.date, name: c.name, campaignId: c.id };
    App.rerender();
    toast(`${fmtN(emails.length)} addresses remembered. Reach will flag them next time.`, 'ok', { action: { label: 'Undo', fn: () => this.undoSent() } });
  },
  async undoSent() { if (!this.s.sent) return; await App.undo(); this.s.sent = null; App.rerender(); },
};
App.register('screen', ScreenView);
