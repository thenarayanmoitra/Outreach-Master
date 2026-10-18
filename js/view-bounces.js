/* =============================================================================
   Reach — Bounces: paste notifications or upload a bounce export, block the
   addresses forever, optionally clean the list you sent from.
   ============================================================================= */
'use strict';

const BouncesView = {
  s: null,
  reset() { this.s = { stage: 'input', text: '', book: null, table: null, cols: null, listBook: null, listTable: null, listEmailCol: -1, campaignId: '', date: todayISO(), typeMode: 'auto', alsoPrev: true, pv: null, result: null, format: Store.state.settings.exportFormat || 'xlsx' }; },
  render(root, sub) {
    if (!this.s) this.reset();
    if (sub === 'new') { this.reset(); App.go('bounces'); return; }
    if (this.s.stage === 'preview') return this.renderPreview(root);
    if (this.s.stage === 'done') return this.renderDone(root);
    const s = this.s, camps = Store.state.campaigns.slice(0, 40);
    root.innerHTML = pageHead({ eyebrow: 'After you send', title: 'Remove bounces', lede: 'Paste the bounce notifications (whole emails are fine), or upload the bounce export from your sending tool. Every address is blocked forever, and any list you sent from can be cleaned at the same time.' }) + `
      <div class="two-col">
        <div class="stack">
          <div class="card card-pad"><div class="field"><label>Bounced addresses or notifications</label><textarea class="textarea paste mono" id="bn-text" placeholder="Paste anything: mailer-daemon emails, a column of addresses, a comma list. System addresses and message ids are ignored.">${esc(s.text)}</textarea><div class="hint" id="bn-found"></div></div>
            <div class="sep"></div><div class="small muted mb-2">Or upload the bounce export (.csv / .xlsx) from Instantly, Lemlist, Mailchimp, Gmail…</div>
            <div id="bn-file">${s.book ? `<div class="list-row">${icon('file')}<span class="grow"><b>${esc(s.book.fileName)}</b> · ${plural(s.table.rows.length, 'row')} · email column <b>${esc(s.table.headers[s.cols.email] || '?')}</b></span><button class="btn btn-quiet btn-xs" data-rm-file>${icon('x', 'ic-sm')}</button></div>` : dropzoneHtml({ title: 'Drop a bounce export', text: 'or click to choose' })}</div></div>
          <div class="card card-pad"><h3 style="font-size:.95rem">Also clean the list you sent from <span class="muted" style="font-weight:500">(optional)</span></h3><div class="small muted mt-1 mb-2">Drop the sheet you mailed. The bounced addresses are taken out and you get the list back with the same columns — 1,000 rows in, 960 out.</div>
            <div id="bn-list">${s.listBook ? `<div class="list-row">${icon('sheet')}<span class="grow"><b>${esc(s.listBook.fileName)}</b> · ${plural(s.listTable.rows.length, 'row')} · email column <b>${esc(s.listTable.headers[s.listEmailCol] || '?')}</b></span><button class="btn btn-quiet btn-xs" data-rm-list>${icon('x', 'ic-sm')}</button></div>` : dropzoneHtml({ title: 'Drop the list you sent', text: 'or click to choose' })}</div></div>
        </div>
        <div class="stack"><div class="card card-pad sticky-side">
          <div class="field"><label>Attach to campaign</label><select class="select sm" id="bn-camp"><option value="">— none —</option>${camps.map(c => `<option value="${c.id}" ${s.campaignId === c.id ? 'selected' : ''}>${esc(c.name)} · ${fmtDate(c.date)}</option>`).join('')}</select><div class="hint">Gives you a bounce rate per campaign on the dashboard.</div></div>
          <div class="field mt-2"><label>Bounce date</label><input class="input sm" type="date" id="bn-date" value="${s.date}"></div>
          <div class="field mt-2"><label>Type</label><div class="seg sm"><button class="${s.typeMode === 'auto' ? 'active' : ''}" data-type="auto">Detect</button><button class="${s.typeMode === 'hard' ? 'active' : ''}" data-type="hard">Hard</button><button class="${s.typeMode === 'soft' ? 'active' : ''}" data-type="soft">Soft</button></div><div class="hint">Hard = blocked forever. Soft (mailbox full, temporary) = flagged as “your call”. Detect reads the notification text.</div></div>
          <button class="btn btn-primary mt-3" style="width:100%" data-preview>${icon('eye')}Preview what will happen</button>
          <div class="tiny muted mt-2">Nothing is saved until you press “Block” on the next screen.</div></div></div>
      </div>`;
    const ta = $('#bn-text', root), found = $('#bn-found', root);
    const upd = () => { s.text = ta.value; const ex = extractEmails(ta.value, { skipSystem: true }); found.innerHTML = ta.value.trim() ? `${plural(ex.valid.length, 'address', 'addresses')} found${ex.ignored.length ? ` · ${ex.ignored.length} system address${ex.ignored.length > 1 ? 'es' : ''} ignored` : ''}${ex.invalid.length ? ` · ${ex.invalid.length} unreadable` : ''}` : ''; };
    ta.addEventListener('input', debounce(upd, 120)); upd();
    const dz = $('#bn-file .dropzone', root); if (dz) wireDropzone(dz, async files => { try { const book = await readBook(files[0]); const name = Object.keys(book.sheets).find(n => book.sheets[n].rows.length); if (!name) return toast('That file has no rows.', 'warn'); s.book = book; s.table = book.sheets[name]; const g = guessColumns(s.table); const H = s.table.headers.map(h => h.toLowerCase()); s.cols = { email: g.email, type: H.findIndex(h => /type|category|class|kind/.test(h)), reason: H.findIndex(h => /reason|error|message|diagnostic|status|detail|code/.test(h)) }; if (s.cols.email < 0) toast('No email column found in that file.', 'warn'); App.rerender(); } catch (e) { toastErr(e); } });
    const rf = $('[data-rm-file]', root); if (rf) rf.onclick = () => { s.book = s.table = s.cols = null; App.rerender(); };
    const dzl = $('#bn-list .dropzone', root); if (dzl) wireDropzone(dzl, async files => { try { const book = await readBook(files[0]); const name = Object.keys(book.sheets).find(n => book.sheets[n].rows.length); if (!name) return toast('That file has no rows.', 'warn'); s.listBook = book; s.listTable = book.sheets[name]; s.listEmailCol = guessColumns(s.listTable).email; if (s.listEmailCol < 0) toast('No email column found in that list.', 'warn'); App.rerender(); } catch (e) { toastErr(e); } });
    const rl = $('[data-rm-list]', root); if (rl) rl.onclick = () => { s.listBook = s.listTable = null; s.listEmailCol = -1; App.rerender(); };
    $('#bn-camp', root).onchange = e => { s.campaignId = e.target.value; };
    $('#bn-date', root).onchange = e => { s.date = e.target.value || todayISO(); };
    $$('[data-type]', root).forEach(b => b.onclick = () => { s.typeMode = b.dataset.type; $$('[data-type]', root).forEach(x => x.classList.toggle('active', x === b)); });
    $('[data-preview]', root).onclick = () => this.preview();
  },
  collect() {
    const s = this.s, items = new Map();
    const put = (email, type, reason, src) => { const e = normEmail(email).email; if (!e) return; const cur = items.get(e); if (!cur) items.set(e, { email: e, type, reason, src }); else { if (type === 'hard') cur.type = 'hard'; if (reason && !cur.reason) cur.reason = reason; } };
    if (s.text.trim()) { const pb = parseBouncePaste(s.text); for (const e of pb.valid) { const info = pb.info.get(e) || { type: 'hard', reason: '' }; put(e, s.typeMode === 'auto' ? info.type : s.typeMode, info.reason, 'paste'); } }
    if (s.table && s.cols.email > -1) for (const row of s.table.rows) {
      const typeText = s.cols.type > -1 ? String(row.cells[s.cols.type] || '') : '', reasonText = s.cols.reason > -1 ? String(row.cells[s.cols.reason] || '') : '';
      const type = s.typeMode === 'auto' ? (/soft|temporar|full|defer/i.test(typeText + ' ' + reasonText) ? 'soft' : 'hard') : s.typeMode;
      for (const raw of cellEmails(row.cells[s.cols.email])) put(raw, type, reasonText.slice(0, 140) || (typeText ? typeText.slice(0, 60) : ''), 'file');
    }
    return [...items.values()];
  },
  preview() {
    const s = this.s, list = this.collect();
    if (!list.length) return toast('No addresses to block yet. Paste the bounces or upload a file.', 'warn');
    const idx = Store.getIndex();
    for (const b of list) { b.already = idx.bounces.get(b.email) || null; b.person = idx.byEmail.get(b.email) || null; b.ledger = idx.ledger.get(b.email) || null; b.include = true; }
    let listInfo = null;
    if (s.listTable && s.listEmailCol > -1) {
      const set = new Set(list.map(b => b.email)); let inList = 0, prev = 0; const items = [];
      for (const row of s.listTable.rows) for (const raw of cellEmails(row.cells[s.listEmailCol])) { const e = normEmail(raw).email; items.push({ row, raw, email: e }); if (e && set.has(e)) inList++; else if (e && idx.bounces.get(e)) prev++; }
      listInfo = { items, inList, prev };
    }
    s.pv = { list, listInfo }; s.stage = 'preview'; App.rerender();
  },
  renderPreview(root) {
    const s = this.s, pv = s.pv, list = pv.list;
    const n = list.filter(b => b.include).length, people = list.filter(b => b.person), already = list.filter(b => b.already).length;
    const camp = Store.state.campaigns.find(c => c.id === s.campaignId);
    root.innerHTML = `<div class="row wrap mb-3"><button class="btn btn-quiet btn-sm" data-back>${icon('chevronL', 'ic-sm')}Back</button><span class="small"><b>${plural(list.length, 'bounced address', 'bounced addresses')}</b> found${camp ? ` · attached to <b>${esc(camp.name)}</b>` : ''} · dated ${fmtDate(s.date)}</span></div>
      ${people.length ? `<div class="callout warn mb-3">${icon('alert')}<div><b>${people.length} of these belong to people in your memory</b> — ${people.slice(0, 4).map(b => `${esc(personLabel(b.person))} (${esc(b.email)})`).join(', ')}${people.length > 4 ? ` and ${people.length - 4} more` : ''}. They stay in memory; the address is marked bounced so you know to find a new one.</div></div>` : ''}
      <div class="two-col"><div class="card"><div class="card-head"><h3>What will happen</h3><span class="small muted">${already ? `${already} already blocked (updated)` : ''}</span></div><div class="table-wrap" style="border:none;border-radius:0;max-height:60vh"><table class="table"><thead><tr><th class="w-check"><input type="checkbox" data-all checked></th><th>Address</th><th>Type</th><th>Reason</th><th>In memory</th></tr></thead><tbody>
        ${list.map((b, i) => `<tr><td class="w-check"><input type="checkbox" data-inc="${i}" ${b.include ? 'checked' : ''}></td><td class="clip" style="max-width:260px"><code>${esc(b.email)}</code></td><td><select class="select sm" data-type="${i}" style="width:auto"><option value="hard" ${b.type === 'hard' ? 'selected' : ''}>Hard</option><option value="soft" ${b.type === 'soft' ? 'selected' : ''}>Soft</option></select></td><td><input class="input sm" data-reason="${i}" value="${esc(b.reason)}" placeholder="—" style="min-width:160px"></td><td class="small">${b.person ? `<button class="chip btn-chip sm" data-open-person="${b.person.id}" style="--c:${STATUSES[b.person.status].color};--c-bg:${STATUSES[b.person.status].bg}">${esc(personLabel(b.person))}</button>` : ''}${b.already ? `<span class="pill" style="--c:var(--red)">already ${b.already.type}</span>` : ''}${b.ledger ? `<span class="pill" style="--c:var(--blue)">mailed ${fmtDate(b.ledger.last)}</span>` : ''}${!b.person && !b.already && !b.ledger ? '<span class="muted">new</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="sticky-side"><div class="card card-pad">
        ${pv.listInfo ? `<div class="small"><b>${esc(s.listBook.fileName)}</b><div class="muted">${plural(s.listTable.rows.length, 'row')} · <b>${pv.listInfo.inList}</b> of the bounced addresses are in it${pv.listInfo.prev ? ` · <b>${pv.listInfo.prev}</b> bounced earlier and are still in it` : ''}</div></div>
          ${pv.listInfo.prev ? `<label class="toggle mt-2"><input type="checkbox" data-prev ${s.alsoPrev ? 'checked' : ''}><span class="tg"></span><span class="small">Also remove the ${pv.listInfo.prev} earlier bounces</span></label>` : ''}
          <div class="field mt-2"><label>Format</label><div class="seg sm"><button class="${s.format === 'xlsx' ? 'active' : ''}" data-fmt="xlsx">.xlsx</button><button class="${s.format === 'csv' ? 'active' : ''}" data-fmt="csv">.csv</button></div></div><div class="sep"></div>` : ''}
        <button class="btn btn-danger" style="width:100%" data-commit>${icon('ban')}Block <span id="bn-n">${fmtN(n)}</span>${pv.listInfo ? ' & download clean list' : ''}</button>
        <div class="tiny muted mt-2">Blocked addresses are saved first; the clean file is only produced once that succeeded. Undo is available afterwards.</div></div></div></div>`;
    $('[data-back]', root).onclick = () => { s.stage = 'input'; App.rerender(); };
    const upd = () => { const k = list.filter(b => b.include).length; $('#bn-n', root).textContent = fmtN(k); $('[data-commit]', root).disabled = !k; };
    $('[data-all]', root).onchange = e => { for (const b of list) b.include = e.target.checked; $$('[data-inc]', root).forEach(c => c.checked = e.target.checked); upd(); };
    $$('[data-inc]', root).forEach(c => c.onchange = () => { list[+c.dataset.inc].include = c.checked; upd(); });
    $$('[data-type]', root).forEach(sel => sel.onchange = () => { list[+sel.dataset.type].type = sel.value; });
    $$('[data-reason]', root).forEach(inp => inp.onchange = () => { list[+inp.dataset.reason].reason = inp.value.trim(); });
    $$('[data-open-person]', root).forEach(b => b.onclick = () => PeopleUI.open(b.dataset.openPerson));
    const pr = $('[data-prev]', root); if (pr) pr.onchange = () => { s.alsoPrev = pr.checked; };
    $$('[data-fmt]', root).forEach(b => b.onclick = () => { s.format = b.dataset.fmt; $$('[data-fmt]', root).forEach(x => x.classList.toggle('active', x === b)); });
    $('[data-commit]', root).onclick = () => this.commit();
  },
  async commit() {
    const s = this.s, list = s.pv.list.filter(b => b.include);
    if (!list.length) return;
    const tx = Store.begin(['bounces', 'people']);
    const r = Store.addBounces(list.map(b => ({ email: b.email, type: b.type, reason: b.reason })), { campaignId: s.campaignId, date: s.date, source: s.book ? 'file' : 'paste' });
    for (const b of list) if (b.person) { const p = Store.state.people.find(x => x.id === b.person.id); if (p) { p.history.push({ ts: nowISO(), type: 'bounce', text: `${b.email} bounced (${b.type})`, campaign: s.campaignId || undefined }); p.updated_at = nowISO(); } }
    const camp = Store.state.campaigns.find(c => c.id === s.campaignId);
    await Store.commit(tx, { label: `Blocked ${list.length} bounced addresses`, type: 'bounce', text: `Blocked ${fmtN(list.length)} bounced addresses (${r.created} new, ${r.updated} already known)${camp ? ` from ${camp.name}` : ''}.` });
    let file = null;
    if (s.pv.listInfo) file = this.cleanList();
    s.result = { n: list.length, created: r.created, updated: r.updated, file }; s.stage = 'done'; App.rerender();
    toast(`${fmtN(list.length)} addresses blocked.`, 'ok', { action: { label: 'Undo', fn: async () => { await App.undo(); this.reset(); App.rerender(); } } });
  },
  cleanList() {
    const s = this.s, li = s.pv.listInfo, remove = new Set(s.pv.list.filter(b => b.include).map(b => b.email));
    const idx = Store.getIndex();
    if (s.alsoPrev) for (const it of li.items) if (it.email && idx.bounces.get(it.email)) remove.add(it.email);
    const byRow = new Map(); for (const it of li.items) { const a = byRow.get(it.row) || []; a.push(it); byRow.set(it.row, a); }
    const keep = []; let removed = 0, rewritten = 0;
    for (const row of s.listTable.rows) {
      const parts = byRow.get(row) || []; const left = parts.filter(it => !(it.email && remove.has(it.email)));
      if (left.length === parts.length) keep.push({ row, overrides: null });
      else if (!left.length) removed++;
      else { keep.push({ row, overrides: new Map([[s.listEmailCol, left.map(it => it.raw).join(', ')]]) }); rewritten++; }
    }
    const aoa = aoaFromTable(s.listTable, keep);
    const name = writeAOA({ aoa, format: s.format, fileName: `${safeName(s.listBook.fileName)} — without bounces ${stamp()}`, sheetName: s.listTable.name });
    return { name, kept: keep.length, removed, rewritten, total: s.listTable.rows.length };
  },
  renderDone(root) {
    const s = this.s, r = s.result;
    root.innerHTML = pageHead({ eyebrow: 'Done', title: `${fmtN(r.n)} addresses blocked` }) + `<div class="card card-pad" style="max-width:640px">
      <div class="row gap-2"><span class="avatar" style="background:var(--green-bg);color:var(--green)">${icon('check')}</span><div><b>${r.created} new, ${r.updated} already known.</b><div class="small muted">They will be flagged as Bounced in every future screening.</div></div></div>
      ${r.file ? `<div class="sep"></div><div class="small"><b>${esc(r.file.name)}</b> downloaded: ${fmtN(r.file.total)} rows → ${fmtN(r.file.kept)} rows (${r.file.removed} removed${r.file.rewritten ? `, ${r.file.rewritten} cells rewritten` : ''}).</div><button class="btn btn-ghost btn-sm mt-2" data-again>${icon('download', 'ic-sm')}Download again</button>` : ''}
      <div class="row mt-3 wrap"><button class="btn btn-primary btn-sm" data-more>More bounces</button><a class="btn btn-ghost btn-sm" href="#/sheets/bounces">See the bounce sheet</a><button class="btn btn-quiet btn-sm" data-undo>${icon('undo', 'ic-sm')}Undo</button></div></div>`;
    $('[data-more]', root).onclick = () => { this.reset(); App.rerender(); };
    $('[data-undo]', root).onclick = async () => { await App.undo(); this.reset(); App.rerender(); };
    const ag = $('[data-again]', root); if (ag) ag.onclick = () => this.cleanList();
  },
};
App.register('bounces', BouncesView);
