/* =============================================================================
   Reach — shared people UI: record drawer, add / import people, log a reply,
   export helpers.
   ============================================================================= */
'use strict';

const PeopleUI = {
  /* ---------- record drawer ---------- */
  open(id) {
    const p = Store.state.people.find(x => x.id === id);
    if (!p) { toast('That record is no longer in memory.', 'warn'); return; }
    const d = openDrawer({ title: personLabel(p), sub: this.subHtml(p), body: this.drawerBody(p), foot: this.drawerFoot(p) });
    this.wireDrawer(d, p);
  },
  subHtml(p) { return `${statusChip(p.status, { sm: true })} <span class="muted">· updated ${relTime(p.updated_at)}${p.source ? ' · from ' + esc(p.source) : ''}</span>`; },
  drawerBody(p) {
    const f = (key, label, type = 'text', extra = '') => `<div class="field"><label>${label}</label><input class="input sm" data-f="${key}" type="${type}" value="${esc(p[key] || '')}" ${extra}></div>`;
    return `
      <div class="section" style="margin-top:0"><h4>Status</h4><div class="status-picker" data-status>${STATUS_KEYS.map(k => `<button data-s="${k}" class="${p.status === k ? 'active' : ''}" style="--c:${STATUSES[k].color};--c-bg:${STATUSES[k].bg}" title="${esc(STATUSES[k].desc)}"><i class="dot" style="background:${STATUSES[k].color}"></i>${STATUSES[k].label}</button>`).join('')}</div>
        <div class="tiny muted mt-1" data-status-desc>${esc(STATUSES[p.status]?.desc || '')}</div></div>
      <div class="section"><h4>Who</h4><div class="form-grid">
        ${f('company', 'Company')}${f('name', 'Contact name')}
        <div class="field full"><label>Email addresses</label><div class="emails-edit input" data-emails>${p.emails.map(e => tagHtml(e, true)).join('')}<input placeholder="add an address, Enter" data-email-new></div><div class="hint">Every address here is blocked by this record’s status. Paste several at once if you like.</div></div>
        ${f('domain', 'Company domain (optional)', 'text', 'placeholder="e.g. drukasia.com — flags anyone at this domain"')}
        <div class="field"><label>Tags</label><div class="list-chip-input" data-tags>${(p.tags || []).map(t => tagHtml(t, true)).join('')}<input placeholder="add a tag, Enter" data-tag-new></div></div>
      </div></div>
      <div class="section"><h4>Dates</h4><div class="form-grid">
        ${f('first_contact', 'First contacted', 'date')}${f('last_contact', 'Last contacted', 'date')}${f('last_reply', 'Last reply', 'date')}${f('revisit_on', 'Revisit on', 'date')}
      </div><div class="hint mt-1">Revisit on: a <b>Not now</b> becomes “your call” in screenings once this date passes.</div></div>
      <div class="section"><h4>Notes</h4><textarea class="textarea" data-f="note" placeholder="What happened, what they said, what to try next…">${esc(p.note || '')}</textarea></div>
      <div class="section"><h4>Timeline</h4>${this.timelineHtml(p)}<div class="row mt-2"><input class="input sm grow" data-note-new placeholder="Add a note to the timeline…"><button class="btn btn-ghost btn-sm" data-note-add>Add</button></div></div>
      <div class="section"><h4>Also in memory</h4>${this.relatedHtml(p)}</div>`;
  },
  timelineHtml(p) {
    const h = (p.history || []).slice().sort((a, b) => a.ts < b.ts ? 1 : -1).slice(0, 40);
    if (!h.length) return '<div class="small muted">No events yet.</div>';
    return `<ul class="timeline">${h.map(e => `<li class="${esc(e.type)}"><div>${esc(e.text)}</div><div class="when">${fmtDateTime(e.ts)}${e.campaign ? ' · ' + esc((Store.state.campaigns.find(c => c.id === e.campaign) || {}).name || 'campaign') : ''}</div></li>`).join('')}</ul>`;
  },
  relatedHtml(p) {
    const idx = Store.getIndex(), out = [];
    for (const e of p.emails) { const b = idx.bounces.get(e); if (b) out.push(`<div class="list-row">${icon('mailx', 'ic-sm')}<span class="grow clip"><b>${esc(e)}</b> bounced on ${fmtDate(b.bounced_at)}</span><span class="pill" style="--c:var(--red)">${b.type}</span></div>`); const l = idx.ledger.get(e); if (l) out.push(`<div class="list-row">${icon('send', 'ic-sm')}<span class="grow clip"><b>${esc(e)}</b> mailed ${l.count === 1 ? 'once' : l.count + ' times'}, last ${fmtDate(l.last)}</span></div>`); }
    const seen = new Set([p.id]);
    for (const d of personDomains(p, idx.freeSet)) for (const q of idx.byDomain.get(d) || []) if (!seen.has(q.id)) { seen.add(q.id); out.push(`<button class="list-row click" data-open-person="${q.id}"><span class="avatar">${initials(personLabel(q))}</span><span class="grow clip"><b>${esc(personLabel(q))}</b> <span class="muted">· same domain @${esc(d)}</span></span>${statusChip(q.status, { sm: true })}</button>`); }
    const clean = cleanCompany(p.company, idx.suffixes);
    if (clean.length >= 3) for (const q of idx.byCompany.get(clean) || []) if (!seen.has(q.id)) { seen.add(q.id); out.push(`<button class="list-row click" data-open-person="${q.id}"><span class="avatar">${initials(personLabel(q))}</span><span class="grow clip"><b>${esc(personLabel(q))}</b> <span class="muted">· same company name</span></span>${statusChip(q.status, { sm: true })}</button>`); }
    return out.length ? `<div class="list-rows">${out.join('')}</div>` : '<div class="small muted">Nothing else in memory relates to this record.</div>';
  },
  drawerFoot(p) {
    return `<button class="btn btn-ghost btn-sm" data-reply>${icon('reply', 'ic-sm')}Log a reply</button><button class="btn btn-ghost btn-sm" data-more>${icon('dots', 'ic-sm')}More</button><span class="grow"></span><button class="btn btn-danger-ghost btn-sm" data-delete>${icon('trash', 'ic-sm')}Delete</button>`;
  },
  wireDrawer(d, p) {
    const save = (patch, label, historyText) => { const tx = Store.begin(['people']); Store.updatePerson(p.id, patch, historyText); Store.commit(tx, { label, type: 'edit', silent: true }); setDrawerTitle(personLabel(p), this.subHtml(p)); };
    $$('[data-f]', d).forEach(inp => {
      inp.addEventListener('change', () => { const key = inp.dataset.f; const val = inp.type === 'date' ? toISODate(inp.value) : inp.value; if ((p[key] || '') === val) return; save({ [key]: key === 'domain' ? rootDomain(domainFromWebsite(val) || val) : val }, `Edited ${key.replace('_', ' ')} of ${personLabel(p)}`); });
    });
    $$('[data-status] button', d).forEach(b => b.onclick = () => { const s = b.dataset.s; if (s === p.status) return; save({ status: s }, `Status of ${personLabel(p)} → ${STATUSES[s].label}`); $$('[data-status] button', d).forEach(x => x.classList.toggle('active', x.dataset.s === s)); $('[data-status-desc]', d).textContent = STATUSES[s].desc; });
    const emailsBox = $('[data-emails]', d), emailNew = $('[data-email-new]', d);
    const renderEmails = () => { $$('.tag', emailsBox).forEach(t => t.remove()); p.emails.slice().reverse().forEach(e => emailsBox.insertAdjacentHTML('afterbegin', tagHtml(e, true))); };
    const addEmails = () => { const ex = extractEmails(emailNew.value); const add = ex.valid.filter(e => !p.emails.includes(e)); if (ex.invalid.length && !ex.valid.length) { emailNew.classList.add('invalid'); return; } emailNew.classList.remove('invalid'); if (!add.length) { emailNew.value = ''; return; } const clash = add.map(e => Store.getIndex().byEmail.get(e)).find(q => q && q.id !== p.id); if (clash) { toast(`${add.find(e => clash.emails.includes(e))} already belongs to ${personLabel(clash)}.`, 'warn', { action: { label: 'Open', fn: () => this.open(clash.id) } }); return; } save({ emails: [...p.emails, ...add] }, `Added ${add.join(', ')} to ${personLabel(p)}`, `Added ${add.join(', ')}`); emailNew.value = ''; renderEmails(); };
    emailNew.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmails(); } });
    emailNew.addEventListener('blur', () => { if (emailNew.value.trim()) addEmails(); });
    emailNew.addEventListener('paste', () => setTimeout(addEmails, 0));
    emailsBox.addEventListener('click', e => { const rm = e.target.closest('[data-rm-tag]'); if (!rm) return; const em = rm.dataset.rmTag; save({ emails: p.emails.filter(x => x !== em) }, `Removed ${em} from ${personLabel(p)}`, `Removed ${em}`); renderEmails(); });
    const tagsBox = $('[data-tags]', d), tagNew = $('[data-tag-new]', d);
    const renderTags = () => { $$('.tag', tagsBox).forEach(t => t.remove()); (p.tags || []).slice().reverse().forEach(t => tagsBox.insertAdjacentHTML('afterbegin', tagHtml(t, true))); };
    const addTag = () => { const t = tagNew.value.trim().replace(/,$/, ''); if (!t) return; if (!(p.tags || []).includes(t)) save({ tags: [...(p.tags || []), t] }, `Tagged ${personLabel(p)} with ${t}`); tagNew.value = ''; renderTags(); };
    tagNew.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } });
    tagsBox.addEventListener('click', e => { const rm = e.target.closest('[data-rm-tag]'); if (!rm) return; save({ tags: (p.tags || []).filter(x => x !== rm.dataset.rmTag) }, `Removed tag from ${personLabel(p)}`); renderTags(); });
    $('[data-note-add]', d).onclick = () => { const inp = $('[data-note-new]', d); const t = inp.value.trim(); if (!t) return; const tx = Store.begin(['people']); const q = Store.state.people.find(x => x.id === p.id); q.history.push({ ts: nowISO(), type: 'note', text: t }); q.updated_at = nowISO(); Store.commit(tx, { label: `Note on ${personLabel(p)}`, silent: true }); inp.value = ''; $('.section .timeline, .section .small.muted', d); const sec = $('[data-note-add]', d).closest('.section'); sec.querySelector('ul, .small.muted').outerHTML = this.timelineHtml(q); };
    $('[data-note-new]', d).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-note-add]', d).click(); } });
    $$('[data-open-person]', d).forEach(b => b.onclick = () => this.open(b.dataset.openPerson));
    $('[data-reply]', d).onclick = () => this.logReply({ personId: p.id });
    $('[data-more]', d).onclick = e => openMenu(e.currentTarget, [
      { label: 'Mark an address as bounced', icon: 'mailx', fn: () => this.markBounced(p) },
      { label: 'Mark as mailed today', icon: 'send', fn: async () => { if (!p.emails.length) return toast('No email on this record.', 'warn'); const tx = Store.begin(['ledger', 'people']); Store.rememberSent(p.emails, { date: todayISO() }); Store.updatePerson(p.id, { last_contact: todayISO() }, 'Marked as mailed'); await Store.commit(tx, { label: `Marked ${personLabel(p)} as mailed`, type: 'sent' }); toast('Remembered as mailed today.'); } },
      { label: 'Copy email', icon: 'copy', fn: () => { copyText(p.emails.join(', ')); toast('Copied'); } },
      { label: 'Find duplicates to merge', icon: 'merge', fn: () => this.mergeInto(p) },
    ], { align: 'right' });
    $('[data-delete]', d).onclick = async () => {
      if (!(await uiConfirm({ title: `Delete ${personLabel(p)}?`, message: 'It goes to the trash for 30 days, and this record will no longer block anything in screenings.', confirmLabel: 'Delete', danger: true }))) return;
      const tx = Store.begin(['people', 'trash']); Store.trashRecords('people', [p.id]);
      await Store.commit(tx, { label: `Deleted ${personLabel(p)}`, type: 'delete' }); closeDrawer();
      toast(`${personLabel(p)} moved to trash.`, 'ok', { action: { label: 'Undo', fn: () => App.undo() } });
    };
  },
  async markBounced(p) {
    if (!p.emails.length) return toast('No email on this record.', 'warn');
    const email = p.emails.length === 1 ? p.emails[0] : await uiPrompt({ title: 'Which address bounced?', label: 'Email', value: p.emails[0] });
    if (!email) return;
    const tx = Store.begin(['bounces', 'people']);
    Store.addBounces([{ email, type: 'hard' }], { source: 'manual' });
    const q = Store.state.people.find(x => x.id === p.id); q.history.push({ ts: nowISO(), type: 'bounce', text: `${normEmail(email).email} marked as bounced` }); q.updated_at = nowISO();
    await Store.commit(tx, { label: `Marked ${email} as bounced`, type: 'bounce' });
    toast(`${normEmail(email).email} is now blocked as bounced.`); this.open(p.id);
  },
  mergeInto(p) {
    const idx = Store.getIndex(); const cands = new Map();
    for (const d of personDomains(p, idx.freeSet)) for (const q of idx.byDomain.get(d) || []) if (q.id !== p.id) cands.set(q.id, q);
    const clean = cleanCompany(p.company, idx.suffixes); if (clean.length >= 3) for (const q of idx.byCompany.get(clean) || []) if (q.id !== p.id) cands.set(q.id, q);
    const nk = nameKey(p.name); if (nameWords(nk).length >= 2) for (const q of idx.byName.get(nk) || []) if (q.id !== p.id) cands.set(q.id, q);
    if (!cands.size) return toast('No likely duplicates of this record.', 'ok');
    const m = openModal({ title: `Merge into ${esc(personLabel(p))}`, sub: 'Tick the records to fold into this one. Emails, tags and notes are combined; the stronger status wins.', body: `<div class="list-rows">${[...cands.values()].map(q => `<label class="list-row"><input type="checkbox" value="${q.id}"><span class="grow clip"><b>${esc(personLabel(q))}</b> <span class="muted">${esc(personSub(q))}</span></span>${statusChip(q.status, { sm: true })}</label>`).join('')}</div>`, foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Merge</button>` });
    $('[data-cancel]', m).onclick = () => closeModal(m);
    $('[data-ok]', m).onclick = async () => { const ids = $$('input:checked', m).map(i => i.value); if (!ids.length) return closeModal(m); const tx = Store.begin(['people']); Store.mergePeople(p.id, ids); await Store.commit(tx, { label: `Merged ${ids.length} into ${personLabel(p)}`, type: 'edit' }); closeModal(m); toast(`Merged ${ids.length} record${ids.length > 1 ? 's' : ''}.`); this.open(p.id); };
  },

  /* ---------- quick add ---------- */
  quickAdd({ status = 'client', email = '', company = '', name = '', onDone = null } = {}) {
    const m = openModal({ title: 'Add to memory', sub: 'One person or company. For a whole sheet use <b>Import a file</b>; for a bunch of lines use <b>Paste many</b>.', body: `
      <div class="status-picker mb-2" data-status>${STATUS_KEYS.map(k => `<button data-s="${k}" class="${status === k ? 'active' : ''}" style="--c:${STATUSES[k].color};--c-bg:${STATUSES[k].bg}"><i class="dot" style="background:${STATUSES[k].color}"></i>${STATUSES[k].label}</button>`).join('')}</div>
      <div class="form-grid">
        <div class="field full"><label>Email address(es)</label><input class="input" id="qa-email" value="${esc(email)}" placeholder="name@company.com, other@company.com" autofocus></div>
        <div class="field"><label>Company</label><input class="input" id="qa-company" value="${esc(company)}"></div>
        <div class="field"><label>Contact name</label><input class="input" id="qa-name" value="${esc(name)}"></div>
        <div class="field full"><label>Note</label><textarea class="textarea" id="qa-note" style="min-height:70px"></textarea></div>
        <div class="field"><label>Revisit on</label><input class="input" type="date" id="qa-revisit"></div>
        <div class="field"><label>Tags</label><input class="input" id="qa-tags" placeholder="comma separated"></div>
      </div><div class="small muted mt-2" id="qa-hint"></div>`,
      foot: `<button class="btn btn-quiet left" data-many>Paste many instead</button><button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Add</button>` });
    let st = status;
    $$('[data-status] button', m).forEach(b => b.onclick = () => { st = b.dataset.s; $$('[data-status] button', m).forEach(x => x.classList.toggle('active', x.dataset.s === st)); });
    const emailInp = $('#qa-email', m), hint = $('#qa-hint', m);
    const checkExisting = () => { const ex = extractEmails(emailInp.value); const q = ex.valid.map(e => Store.getIndex().byEmail.get(e)).find(Boolean); hint.innerHTML = q ? `${icon('info', 'ic-sm')} <b>${esc(q.emails.find(e => ex.valid.includes(e)))}</b> is already in memory as ${statusChip(q.status, { sm: true })} ${esc(personLabel(q))}. Adding will update that record.` : ''; };
    emailInp.addEventListener('input', debounce(checkExisting, 150)); checkExisting();
    $('[data-cancel]', m).onclick = () => closeModal(m);
    $('[data-many]', m).onclick = () => { closeModal(m); this.pasteMany({ status: st, onDone }); };
    $('[data-ok]', m).onclick = async () => {
      const ex = extractEmails(emailInp.value); const comp = $('#qa-company', m).value.trim(), nm = $('#qa-name', m).value.trim();
      if (!ex.valid.length && !comp) { emailInp.classList.add('invalid'); return toast('Enter at least an email address or a company name.', 'warn'); }
      if (ex.invalid.length) { emailInp.classList.add('invalid'); return toast(`Not an email address: ${ex.invalid[0]}`, 'warn'); }
      const tx = Store.begin(['people']);
      const r = Store.upsertPerson({ emails: ex.valid, company: comp, name: nm, status: st, note: $('#qa-note', m).value.trim(), revisit_on: $('#qa-revisit', m).value, tags: $('#qa-tags', m).value.split(',').map(s => s.trim()).filter(Boolean), source: 'manual' });
      await Store.commit(tx, { label: `${r.action === 'added' ? 'Added' : 'Updated'} ${personLabel(r.person)}`, type: 'add' });
      closeModal(m); toast(`${personLabel(r.person)} ${r.action === 'added' ? 'added as' : 'updated to'} ${STATUSES[st].label}.`, 'ok', { action: { label: 'Open', fn: () => this.open(r.person.id) } });
      onDone && onDone(r);
    };
  },
  pasteMany({ status = 'client', onDone = null } = {}) {
    const m = openModal({ title: 'Paste many', size: 'lg', sub: 'One per line. Any of: <code>email</code> · <code>email, Company, Name</code> · <code>Name &lt;email&gt;</code> · a column copied from a sheet. A line with just a company name becomes a company-only record.', body: `
      <div class="status-picker mb-2" data-status>${STATUS_KEYS.map(k => `<button data-s="${k}" class="${status === k ? 'active' : ''}" style="--c:${STATUSES[k].color};--c-bg:${STATUSES[k].bg}"><i class="dot" style="background:${STATUSES[k].color}"></i>${STATUSES[k].label}</button>`).join('')}</div>
      <textarea class="textarea paste mono" id="pm-text" placeholder="ashley.chen@drukasia.com, Druk Asia, Ashley Chen&#10;Tara O'Sullivan <tosullivan@gbta.org>&#10;Blue Poppy Bhutan" autofocus></textarea>
      <div class="small muted mt-2" id="pm-preview"></div>`,
      foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Add</button>` });
    let st = status; const ta = $('#pm-text', m), pv = $('#pm-preview', m);
    $$('[data-status] button', m).forEach(b => b.onclick = () => { st = b.dataset.s; $$('[data-status] button', m).forEach(x => x.classList.toggle('active', x.dataset.s === st)); });
    const parse = () => this.parsePeopleLines(ta.value);
    ta.addEventListener('input', debounce(() => { const rows = parse(); const bad = rows.filter(r => r.invalid).length; pv.innerHTML = rows.length ? `${plural(rows.length, 'line')} · ${rows.filter(r => r.emails.length).length} with an email · ${rows.filter(r => !r.emails.length && r.company).length} company-only${bad ? ` · <span style="color:var(--red)">${bad} unreadable</span>` : ''}` : ''; }, 120));
    $('[data-cancel]', m).onclick = () => closeModal(m);
    $('[data-ok]', m).onclick = async () => {
      const rows = parse().filter(r => !r.invalid && (r.emails.length || r.company)); if (!rows.length) return toast('Nothing usable to add.', 'warn');
      const tx = Store.begin(['people']); let added = 0, merged = 0;
      for (const r of rows) { const res = Store.upsertPerson({ ...r, status: st, source: 'paste' }); res.action === 'added' ? added++ : merged++; }
      await Store.commit(tx, { label: `Added ${added} people (${merged} updated)`, type: 'add' });
      closeModal(m); toast(`${added} added, ${merged} updated as ${STATUSES[st].label}.`); onDone && onDone({ added, merged });
    };
  },
  parsePeopleLines(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const emails = extractEmails(line).valid;
      let rest = line;
      for (const t of line.match(EMAILISH_RE) || []) rest = rest.replace(t, ' ');
      const cells = (rest.includes('\t') ? rest.split('\t') : rest.split(/\s*[,;]\s*/)).map(s => s.replace(/[<>"'()]/g, ' ').replace(/mailto:?/i, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!emails.length && line.includes('@')) { out.push({ invalid: true, raw: line }); continue; }
      let company = '', name = '';
      if (cells.length >= 2) { company = cells[0]; name = cells[1]; }
      else if (cells.length === 1) { if (emails.length && nameWords(nameKey(cells[0])).length >= 2 && cells[0].split(' ').length <= 3 && !/\b(ltd|inc|llc|travel|tours|dmc|hotel|group|association)\b/i.test(cells[0])) name = cells[0]; else company = cells[0]; }
      out.push({ emails, company, name, raw: line });
    }
    return out;
  },

  /* ---------- import a file ---------- */
  importFile({ onDone = null } = {}) {
    const m = openModal({ title: 'Import people from a file', size: 'xl', sub: 'Your existing client list, a replies sheet, an old tracker. Reach reads the columns, suggests a status per row from the notes, and merges rows into people already in memory.', body: `<div id="imp-body">${dropzoneHtml({ title: 'Drop a .xlsx or .csv', text: 'or click to choose — Google Sheets: File → Download → .csv' })}<div class="small muted mt-2 center">Or paste cells straight from Google Sheets:</div><textarea class="textarea mono mt-1" id="imp-paste" placeholder="Paste here (⌘V)" style="min-height:80px"></textarea></div>`, foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok disabled>Import</button>` });
    const body = $('#imp-body', m), okBtn = $('[data-ok]', m);
    $('[data-cancel]', m).onclick = () => closeModal(m);
    const state = { book: null, table: null, map: null, rows: [], defaultStatus: 'client' };
    const gotBook = book => { state.book = book; const names = Object.keys(book.sheets); state.table = book.sheets[names[0]]; state.map = this.guessImportColumns(state.table); renderMap(); };
    wireDropzone($('.dropzone', body), async files => { try { gotBook(await readBook(files[0])); } catch (e) { toastErr(e); } });
    const pasteBox = $('#imp-paste', body), usePaste = () => { const t = pasteBox.value; if (t.trim() && t.includes('\n')) gotBook({ fileName: 'Pasted', sheets: { Pasted: tableFromText(t, 'Pasted') } }); };
    pasteBox.addEventListener('paste', () => setTimeout(usePaste, 0));
    pasteBox.addEventListener('input', debounce(usePaste, 400));
    const renderMap = () => {
      const t = state.table, H = t.headers; const opt = (sel, none = '— none —') => `<option value="-1">${none}</option>` + H.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h)}</option>`).join('');
      const sheets = Object.keys(state.book.sheets);
      body.innerHTML = `
        <div class="row wrap gap-3 mb-3"><div class="small"><b>${esc(state.book.fileName)}</b> · ${plural(t.rows.length, 'row')}</div>${sheets.length > 1 ? `<select class="select sm" id="imp-sheet" style="width:auto">${sheets.map(s => `<option ${s === t.name ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
          <div class="row gap-2" style="margin-left:auto"><span class="small muted">Status when a row has no recognisable note:</span><select class="select sm" id="imp-default" style="width:auto">${STATUS_KEYS.map(k => `<option value="${k}" ${state.defaultStatus === k ? 'selected' : ''}>${STATUSES[k].label}</option>`).join('')}</select></div></div>
        <div class="mapping">${[['email', 'Email'], ['company', 'Company'], ['name', 'Contact name'], ['note', 'Notes / responses'], ['status', 'Status column'], ['tags', 'Tags'], ['date', 'Date (first contact)'], ['website', 'Website']].map(([k, l]) => `<div class="field"><label>${l}</label><select class="select sm" data-map="${k}">${opt(state.map[k])}</select></div>`).join('')}</div>
        <div class="small muted mt-2">Statuses are suggested from the notes (“got hired” → Client, “no budget” → Not now, “will talk in a few months” → Not now with a revisit date…). Change any of them below before importing.</div>
        <div class="mt-3" id="imp-preview"></div>`;
      $$('[data-map]', body).forEach(s => s.onchange = () => { state.map[s.dataset.map] = +s.value; buildRows(); });
      const sh = $('#imp-sheet', body); if (sh) sh.onchange = () => { state.table = state.book.sheets[sh.value]; state.map = this.guessImportColumns(state.table); renderMap(); };
      $('#imp-default', body).onchange = e => { state.defaultStatus = e.target.value; buildRows(); };
      buildRows();
    };
    const buildRows = () => {
      const t = state.table, mp = state.map; const idx = Store.getIndex();
      state.rows = t.rows.map(row => {
        const cell = i => i > -1 ? String(row.cells[i] || '').trim() : '';
        const emails = mp.email > -1 ? cellEmails(row.cells[mp.email]).map(e => normEmail(e).email).filter(Boolean) : [];
        const note = cell(mp.note), company = cell(mp.company), name = cell(mp.name);
        const explicit = mp.status > -1 ? this.statusFromText(cell(mp.status), null) : null;
        const sug = explicit || this.statusFromText(note, null) || this.statusFromText(company + ' ' + name, null) || state.defaultStatus;
        const existing = emails.map(e => idx.byEmail.get(e)).find(Boolean) || (!emails.length && company ? Store.findPersonByCompany(company) : null);
        const revisit = /few months|couple of months|next (quarter|year)|later this year|in \d+ months/i.test(note) ? isoOf(new Date(Date.now() + 90 * 86400000)) : '';
        return { n: row.n, emails, company, name, note, status: sug, tags: mp.tags > -1 ? cell(mp.tags).split(/[,;]/).map(s => s.trim()).filter(Boolean) : [], first_contact: mp.date > -1 ? toISODate(cell(mp.date)) : '', website: cell(mp.website), existing, revisit_on: revisit, include: !!(emails.length || company) };
      });
      renderPreview();
    };
    const renderPreview = () => {
      const rows = state.rows; const ok = rows.filter(r => r.include).length;
      okBtn.disabled = !ok; okBtn.textContent = `Import ${fmtN(ok)}`;
      const counts = {}; for (const r of rows) if (r.include) counts[r.status] = (counts[r.status] || 0) + 1;
      $('#imp-preview', body).innerHTML = `<div class="row wrap gap-2 mb-2"><span class="small"><b>${fmtN(ok)}</b> rows to import · ${rows.filter(r => r.include && r.existing).length} merge into existing people</span><span class="grow"></span>${Object.entries(counts).map(([k, v]) => `<span class="chip sm" style="--c:${STATUSES[k].color};--c-bg:${STATUSES[k].bg}">${STATUSES[k].label} ${v}</span>`).join('')}<div class="row gap-1"><span class="small muted">Set all to</span><select class="select sm" id="imp-all" style="width:auto"><option value="">…</option>${STATUS_KEYS.map(k => `<option value="${k}">${STATUSES[k].label}</option>`).join('')}</select></div></div>
        <div class="table-wrap" style="max-height:40vh"><table class="table preview-table"><thead><tr><th></th><th>Row</th><th>Company</th><th>Contact</th><th>Email</th><th>Status</th><th>Note</th><th>Memory</th></tr></thead><tbody>
        ${rows.slice(0, 500).map((r, i) => `<tr><td><input type="checkbox" data-inc="${i}" ${r.include ? 'checked' : ''} ${!(r.emails.length || r.company) ? 'disabled' : ''}></td><td class="muted">${r.n}</td><td title="${esc(r.company)}">${esc(r.company) || '<span class="muted">—</span>'}</td><td>${esc(r.name)}</td><td title="${esc(r.emails.join(', '))}">${esc(r.emails[0] || '') || '<span class="muted" title="No email: company-only record">no email</span>'}${r.emails.length > 1 ? ` <span class="muted">+${r.emails.length - 1}</span>` : ''}</td><td><select class="select sm" data-st="${i}" style="min-width:120px">${STATUS_KEYS.map(k => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${STATUSES[k].label}</option>`).join('')}</select></td><td title="${esc(r.note)}">${esc(r.note.slice(0, 60))}${r.note.length > 60 ? '…' : ''}</td><td>${r.existing ? `<span class="pill" style="--c:var(--blue)">merges into ${esc(personLabel(r.existing))}</span>` : '<span class="muted">new</span>'}</td></tr>`).join('')}
        </tbody></table></div>${rows.length > 500 ? `<div class="small muted mt-1">Showing the first 500 of ${fmtN(rows.length)} rows; all are imported.</div>` : ''}`;
      $$('[data-inc]', body).forEach(c => c.onchange = () => { state.rows[+c.dataset.inc].include = c.checked; const ok2 = state.rows.filter(r => r.include).length; okBtn.disabled = !ok2; okBtn.textContent = `Import ${fmtN(ok2)}`; });
      $$('[data-st]', body).forEach(s => s.onchange = () => { state.rows[+s.dataset.st].status = s.value; });
      $('#imp-all', body).onchange = e => { if (!e.target.value) return; for (const r of state.rows) r.status = e.target.value; renderPreview(); };
    };
    okBtn.onclick = async () => {
      const rows = state.rows.filter(r => r.include); if (!rows.length) return;
      okBtn.disabled = true; okBtn.innerHTML = '<span class="spin"></span> Importing';
      const p = startProgress().step('Importing', `${plural(rows.length, 'row')} from ${state.book.fileName}`, rows.length);
      const tx = Store.begin(['people']); let added = 0, merged = 0, i = 0;
      for (const r of rows) {
        const res = Store.upsertPerson({ emails: r.emails, company: r.company, name: r.name, note: r.note, status: r.status, tags: r.tags, first_contact: r.first_contact, revisit_on: r.revisit_on, domain: r.website ? domainFromWebsite(r.website) : '', source: state.book.fileName, historyNote: `Imported from ${state.book.fileName} (row ${r.n})`, historyType: 'import' });
        res.action === 'added' ? added++ : merged++;
        if (++i % 200 === 0) { p.set(i); await yieldToPaint(); }
      }
      await Store.commit(tx, { label: `Imported ${added + merged} people from ${state.book.fileName}`, type: 'import', text: `Imported ${state.book.fileName}: ${added} people added, ${merged} merged into existing records.` });
      p.close(); closeModal(m);
      toast(`${added} added, ${merged} merged from ${state.book.fileName}.`, 'ok', { action: { label: 'Undo', fn: () => App.undo() } });
      onDone && onDone({ added, merged });
    };
  },
  guessImportColumns(table) {
    const g = guessColumns(table); const H = table.headers.map(h => h.toLowerCase());
    const find = res => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i > -1) return i; } return -1; };
    return { email: g.email, company: g.company, name: g.name, note: find([/note|response|remark|comment|status|outcome|reply|result/]), status: find([/^status$|^stage$|^outcome$|^label$|^colou?r/]), tags: find([/tag|category|segment|type/]), date: find([/date|sent|contacted|first/]), website: g.website };
  },
  statusFromText(text, fallback = 'notnow') {
    const n = String(text || '').toLowerCase().trim();
    if (!n) return fallback;
    const exact = STATUS_KEYS.find(k => n === k || n === STATUSES[k].label.toLowerCase() || n === STATUSES[k].short.toLowerCase());
    if (exact) return exact;
    if (/do not contact|don'?t contact|unsubscribe|stop (e)?mailing|remove me|dnc|never again|blocked/.test(n)) return 'dnc';
    if (/got hired|hired|signed|working together|currently working|active client|^client|retainer|onboard/.test(n)) return 'client';
    if (/past client|former client|worked (for|with).*(month|week)|did not really work out|ended|churn|completed/.test(n)) return 'past';
    if (/proposal sent|sent (the|a) proposal|audit sent|quote sent|awaiting|waiting for|waiting on|pipeline|in review|considering/.test(n)) return 'pipeline';
    if (/most likely|likely will|had a call|call booked|interested|positive|warm|showed interest|wants to|keen|let'?s talk|follow.?up|demo|meeting/.test(n)) return 'warm';
    if (/no budget|broke|cheap|not now|no response|radio.?silent|dead|closed|declined|not looking|stopped responding|didn'?t respond|did not respond|no luck|dropped|found someone else|not interested|rejected|pass|few months|later/.test(n)) return 'notnow';
    return fallback;
  },

  /* ---------- log a reply ---------- */
  logReply({ personId = null, email = '', campaignId = '', onDone = null } = {}) {
    const p = personId ? Store.state.people.find(x => x.id === personId) : (email ? Store.findPersonByEmail(email) : null);
    const camps = Store.state.campaigns.slice(0, 30);
    const m = openModal({ title: p ? `Reply from ${esc(personLabel(p))}` : 'Log a reply', sub: p ? '' : 'Paste the <code>From:</code> line of the email, or type the address. If they are already in memory, their record is updated.', body: `
      ${p ? '' : `<div class="field"><label>Who replied</label><input class="input" id="lr-from" value="${esc(email)}" placeholder="Grace Kang <grace@greenview.sg>" autofocus><div class="hint" id="lr-known"></div></div>
      <div class="form-grid mt-2"><div class="field"><label>Company</label><input class="input sm" id="lr-company"></div><div class="field"><label>Contact name</label><input class="input sm" id="lr-name"></div></div>`}
      <div class="field mt-2"><label>What did they say?</label><div class="status-picker" data-status>${['warm', 'pipeline', 'client', 'notnow', 'dnc'].map(k => `<button data-s="${k}" class="${(p ? p.status : 'warm') === k ? 'active' : ''}" style="--c:${STATUSES[k].color};--c-bg:${STATUSES[k].bg}"><i class="dot" style="background:${STATUSES[k].color}"></i>${STATUSES[k].label}</button>`).join('')}</div></div>
      <div class="form-grid mt-2"><div class="field full"><label>Note</label><textarea class="textarea" id="lr-note" style="min-height:70px" placeholder="Asked for an audit, call next Tuesday…"></textarea></div>
        <div class="field"><label>Reply date</label><input class="input sm" type="date" id="lr-date" value="${todayISO()}"></div>
        <div class="field"><label>Revisit on <span class="muted">(for Not now)</span></label><input class="input sm" type="date" id="lr-revisit"></div>
        ${camps.length ? `<div class="field full"><label>Which campaign did they reply to?</label><select class="select sm" id="lr-camp"><option value="">— not from a campaign —</option>${camps.map(c => `<option value="${c.id}" ${c.id === campaignId ? 'selected' : ''}>${esc(c.name)} · ${fmtDate(c.date)}</option>`).join('')}</select></div>` : ''}
      </div>`, foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Save reply</button>` });
    let st = p ? (p.status === 'notnow' || p.status === 'past' ? 'warm' : p.status) : 'warm';
    $$('[data-status] button', m).forEach(b => { b.classList.toggle('active', b.dataset.s === st); b.onclick = () => { st = b.dataset.s; $$('[data-status] button', m).forEach(x => x.classList.toggle('active', x.dataset.s === st)); }; });
    const from = $('#lr-from', m);
    if (from) {
      const known = $('#lr-known', m);
      const upd = () => { const { name, email: em } = parseFromLine(from.value); const q = em ? Store.findPersonByEmail(em) : null; if (q) { known.innerHTML = `${icon('info', 'ic-sm')} In memory as ${statusChip(q.status, { sm: true })} <b>${esc(personLabel(q))}</b> — this reply will be added to that record.`; if (!$('#lr-company', m).value) $('#lr-company', m).value = q.company; if (!$('#lr-name', m).value) $('#lr-name', m).value = q.name; } else { known.textContent = em ? 'New to memory — a record will be created.' : ''; if (name && !$('#lr-name', m).value) $('#lr-name', m).value = name; const l = em ? Store.getIndex().ledger.get(em) : null; if (l) known.textContent += ` Mailed ${l.count === 1 ? 'once' : l.count + ' times'}, last ${fmtDate(l.last)}.`; } };
      from.addEventListener('input', debounce(upd, 150)); upd();
    }
    $('[data-cancel]', m).onclick = () => closeModal(m);
    $('[data-ok]', m).onclick = async () => {
      let emails = p ? p.emails : [], company = p ? p.company : '', name = p ? p.name : '';
      if (!p) { const pf = parseFromLine(from.value); if (!pf.email) { from.classList.add('invalid'); return toast('Enter the email address that replied.', 'warn'); } emails = [pf.email]; company = $('#lr-company', m).value.trim(); name = $('#lr-name', m).value.trim() || pf.name; }
      const note = $('#lr-note', m).value.trim(), date = $('#lr-date', m).value || todayISO(), revisit = $('#lr-revisit', m).value, camp = $('#lr-camp', m) ? $('#lr-camp', m).value : '';
      const tx = Store.begin(['people']);
      const r = Store.upsertPerson({ emails, company, name, status: st, note, revisit_on: revisit, last_reply: date, campaign: camp, historyType: 'reply', historyNote: `Replied${note ? ': ' + note : ''}`, source: p ? undefined : 'reply' });
      if (p) { const q = r.person; q.last_reply = date; if (revisit) q.revisit_on = revisit; }
      await Store.commit(tx, { label: `Logged reply from ${personLabel(r.person)}`, type: 'reply', text: `Reply from ${personLabel(r.person)} → ${STATUSES[st].label}${note ? ': ' + note.slice(0, 80) : ''}` });
      closeModal(m); toast(`Reply logged. ${personLabel(r.person)} is now ${STATUSES[st].label}.`, 'ok', { action: { label: 'Open', fn: () => this.open(r.person.id) } });
      onDone && onDone(r);
    };
  },

  /* ---------- export helpers ---------- */
  exportPeople(people, { fileName = 'Reach memory', format } = {}) {
    const fmt = format || Store.state.settings.exportFormat || 'xlsx';
    const aoa = [['Company', 'Contact', 'Emails', 'Status', 'Note', 'Tags', 'Domain', 'First contact', 'Last contact', 'Last reply', 'Revisit on', 'Source', 'Updated']];
    for (const p of people) aoa.push([p.company, p.name, p.emails.join(', '), STATUSES[p.status]?.label || p.status, p.note, (p.tags || []).join(', '), p.domain || '', p.first_contact, p.last_contact, p.last_reply, p.revisit_on, p.source, (p.updated_at || '').slice(0, 10)]);
    return writeAOA({ aoa, format: fmt, fileName: `${fileName} ${stamp()}`, sheetName: 'People' });
  },
};
