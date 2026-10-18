/* =============================================================================
   Reach — Sheets: every table in memory, fully editable.
   People · Bounces · Mailed · Campaigns · Trash · Activity
   ============================================================================= */
'use strict';

const SheetsView = {
  tab: 'people', grid: null, statusFilter: 'all', activityFilter: 'all',
  tabs: [['people', 'People', 'users'], ['bounces', 'Bounces', 'mailx'], ['mailed', 'Mailed', 'send'], ['campaigns', 'Campaigns', 'rocket'], ['trash', 'Trash', 'trash'], ['activity', 'Activity', 'history']],
  counts() { const s = Store.state; return { people: s.people.length, bounces: s.bounces.length, mailed: s.ledger.length, campaigns: s.campaigns.length, trash: s.trash.length, activity: s.activity.length }; },
  render(root, sub) {
    const tab = this.tabs.some(t => t[0] === sub) ? sub : 'people';
    if (root.dataset.view === 'sheets' && root.dataset.tab === tab && this.grid && this.grid.el.isConnected) { this.refresh(root); return; }
    root.dataset.view = 'sheets'; root.dataset.tab = tab; this.tab = tab; this.grid = null;
    root.innerHTML = pageHead({ eyebrow: 'Your memory', title: 'Sheets', lede: 'Everything Reach knows, as editable sheets. Double-click any cell (or just start typing) to change it. Every change is saved on this device at once and can be undone.' }) + `<div class="tabs" id="sheet-tabs"></div><div id="sheet-body"></div>`;
    this.renderTabs(root);
    this['render_' + tab]($('#sheet-body', root));
  },
  renderTabs(root) {
    const c = this.counts();
    $('#sheet-tabs', root).innerHTML = this.tabs.map(([k, l, ic]) => `<button class="${this.tab === k ? 'active' : ''}" data-tab="${k}">${icon(ic, 'ic-sm')}${l}<span class="cnt">${fmtN(c[k])}</span></button>`).join('');
    $$('[data-tab]', root).forEach(b => b.onclick = () => App.go('sheets', b.dataset.tab));
  },
  refresh(root) { this.renderTabs(root); if (this.grid) this.grid.setRows(this.rows()); const sc = $('#status-chips', root); if (sc) sc.innerHTML = this.statusChipsHtml(); this.wireStatusChips(root); },
  rows() {
    const s = Store.state;
    switch (this.tab) {
      case 'people': return this.statusFilter === 'all' ? s.people : s.people.filter(p => p.status === this.statusFilter);
      case 'bounces': return s.bounces;
      case 'mailed': return s.ledger;
      case 'campaigns': return s.campaigns;
      default: return [];
    }
  },
  commitQuiet(colls, label) { return tx => Store.commit(tx, { label, silent: true, quiet: true }); },

  /* ---------- People ---------- */
  statusChipsHtml() {
    const by = {}; for (const p of Store.state.people) by[p.status] = (by[p.status] || 0) + 1;
    return `<button class="chip btn-chip sm ${this.statusFilter === 'all' ? '' : 'outline'}" data-sf="all" style="--c:var(--text);--c-bg:var(--grey-bg)">All ${fmtN(Store.state.people.length)}</button>` + STATUS_KEYS.map(k => `<button class="chip btn-chip sm ${this.statusFilter === k ? '' : 'outline'}" data-sf="${k}" style="--c:${STATUSES[k].color};--c-bg:${STATUSES[k].bg}"><i class="dot"></i>${STATUSES[k].short} ${fmtN(by[k] || 0)}</button>`).join('');
  },
  wireStatusChips(root) { $$('[data-sf]', root).forEach(b => b.onclick = () => { this.statusFilter = b.dataset.sf; $('#status-chips', root).innerHTML = this.statusChipsHtml(); this.wireStatusChips(root); this.grid.setRows(this.rows()); }); },
  render_people(body) {
    const idx = () => Store.getIndex();
    this.grid = new Grid({
      storageKey: 'people', rows: this.rows(), rowHeight: 40, searchPlaceholder: 'Search company, name, email, tag…',
      searchText: p => `${p.company} ${p.name} ${p.emails.join(' ')} ${(p.tags || []).join(' ')} ${p.note} ${p.source}`,
      sort: { key: 'updated_at', dir: -1 },
      columns: [
        { key: '_check', width: '36px' }, { key: '_open', width: '34px' },
        { key: 'company', label: 'Company', width: 'minmax(180px,240px)', editable: true },
        { key: 'name', label: 'Contact', width: '150px', editable: true },
        { key: 'emails', label: 'Emails', type: 'emails', width: '230px', editable: true, sortVal: p => p.emails[0] || '' },
        { key: 'status', label: 'Status', type: 'status', width: '130px', editable: true, sortVal: p => STATUSES[p.status]?.order ?? 9 },
        { key: 'note', label: 'Notes', type: 'note', width: 'minmax(240px,1fr)', editable: true },
        { key: 'tags', label: 'Tags', type: 'tags', width: '150px', editable: true, sortVal: p => (p.tags || []).join(',') },
        { key: 'revisit_on', label: 'Revisit', type: 'date', width: '118px', editable: true },
        { key: 'last_reply', label: 'Last reply', type: 'date', width: '118px', editable: true },
        { key: 'last_contact', label: 'Last mailed', type: 'date', width: '118px', editable: true },
        { key: 'first_contact', label: 'First contact', type: 'date', width: '118px', editable: true },
        { key: 'domain', label: 'Domain', width: '150px', editable: true },
        { key: 'source', label: 'Source', width: '140px', editable: true },
        { key: 'updated_at', label: 'Updated', type: 'date', width: '110px' },
      ],
      onEdit: (p, col, val, orig) => {
        const patch = {};
        if (col.key === 'emails') {
          const ex = val.map(e => normEmail(e)); const bad = val.filter((e, i) => !ex[i].valid);
          if (bad.length) return toast(`Not an email address: ${bad[0]}`, 'warn');
          const emails = uniq(ex.map(e => e.email));
          const clash = emails.map(e => idx().byEmail.get(e)).find(q => q && q.id !== p.id);
          if (clash) return toast(`${emails.find(e => clash.emails.includes(e))} already belongs to ${personLabel(clash)}.`, 'warn', { action: { label: 'Open', fn: () => PeopleUI.open(clash.id) } });
          patch.emails = emails;
        } else if (col.key === 'domain') patch.domain = val ? rootDomain(domainFromWebsite(val) || val) : '';
        else patch[col.key] = val;
        const tx = Store.begin(['people']); Store.updatePerson(p.id, patch);
        Store.commit(tx, { label: `Edited ${col.label.toLowerCase()} of ${personLabel(p)}`, silent: true, quiet: true }); this.grid.refresh();
      },
      onOpen: p => PeopleUI.open(p.id),
      bulk: [
        { label: 'Set status', icon: 'tag', fn: (ids, g) => openMenu($('[data-bulk="0"]', g.bulk), STATUS_KEYS.map(k => ({ label: STATUSES[k].label, fn: async () => { const tx = Store.begin(['people']); for (const id of ids) Store.updatePerson(id, { status: k }); await Store.commit(tx, { label: `Set ${ids.length} people to ${STATUSES[k].label}`, type: 'edit' }); g.clearSelection(); toast(`${ids.length} set to ${STATUSES[k].label}.`); } }))) },
        { label: 'Add tag', icon: 'plus', fn: async (ids, g) => { const t = await uiPrompt({ title: 'Add a tag', label: 'Tag' }); if (!t || !t.trim()) return; const tx = Store.begin(['people']); for (const id of ids) { const p = Store.state.people.find(x => x.id === id); if (p && !(p.tags || []).includes(t.trim())) Store.updatePerson(id, { tags: [...(p.tags || []), t.trim()] }); } await Store.commit(tx, { label: `Tagged ${ids.length} people with ${t.trim()}`, type: 'edit' }); g.clearSelection(); } },
        { label: 'Revisit date', icon: 'calendar', fn: async (ids, g) => { const d = await uiPrompt({ title: 'Set revisit date', label: 'Date', type: 'date', value: isoOf(new Date(Date.now() + 90 * 86400000)) }); if (!d) return; const tx = Store.begin(['people']); for (const id of ids) Store.updatePerson(id, { revisit_on: toISODate(d) }); await Store.commit(tx, { label: `Set revisit date for ${ids.length} people`, type: 'edit' }); g.clearSelection(); } },
        { label: 'Merge', icon: 'merge', fn: async (ids, g) => { if (ids.length < 2) return toast('Select at least two records to merge.', 'warn'); const people = ids.map(id => Store.state.people.find(p => p.id === id)).filter(Boolean); const keep = people[0]; if (!(await uiConfirm({ title: `Merge ${ids.length} records?`, message: `Everything is folded into <b>${esc(personLabel(keep))}</b>: emails, tags, notes and timelines are combined, the stronger status wins. The other ${ids.length - 1} record${ids.length > 2 ? 's are' : ' is'} removed.`, confirmLabel: 'Merge' }))) return; const tx = Store.begin(['people']); Store.mergePeople(keep.id, ids.slice(1)); await Store.commit(tx, { label: `Merged ${ids.length} records into ${personLabel(keep)}`, type: 'edit' }); g.clearSelection(); toast('Merged.', 'ok', { action: { label: 'Open', fn: () => PeopleUI.open(keep.id) } }); } },
        { label: 'Export', icon: 'download', fn: ids => { const set = new Set(ids); PeopleUI.exportPeople(Store.state.people.filter(p => set.has(p.id)), { fileName: 'Reach people (selection)' }); } },
        { label: 'Delete', icon: 'trash', fn: async (ids, g) => { if (!(await uiConfirm({ title: `Delete ${ids.length} ${ids.length === 1 ? 'record' : 'records'}?`, message: 'They go to the trash for 30 days and stop blocking anything in screenings.', confirmLabel: 'Delete', danger: true }))) return; const tx = Store.begin(['people', 'trash']); Store.trashRecords('people', ids); await Store.commit(tx, { label: `Deleted ${ids.length} people`, type: 'delete' }); g.clearSelection(); toast(`${ids.length} moved to trash.`, 'ok', { action: { label: 'Undo', fn: () => App.undo() } }); } },
      ],
      empty: emptyState({ icon: 'users', title: 'No people yet', text: 'Add your clients and everyone who replied, so they are never cold-mailed again.' }),
    });
    this.grid.slot.innerHTML = `<div class="row wrap gap-1" id="status-chips">${this.statusChipsHtml()}</div><span class="grow"></span><button class="btn btn-ghost btn-sm" data-add>${icon('plus', 'ic-sm')}Add</button><button class="btn btn-ghost btn-sm" data-import>${icon('upload', 'ic-sm')}Import file</button><button class="btn btn-ghost btn-sm" data-export>${icon('download', 'ic-sm')}Export</button>`;
    this.wireStatusChips(this.grid.slot);
    $('[data-add]', this.grid.slot).onclick = e => openMenu(e.currentTarget, [{ label: 'One person or company', icon: 'user', fn: () => PeopleUI.quickAdd({ status: 'client' }) }, { label: 'Paste many lines', icon: 'paste', fn: () => PeopleUI.pasteMany({ status: 'client' }) }, { label: 'Log a reply', icon: 'reply', fn: () => PeopleUI.logReply({}) }]);
    $('[data-import]', this.grid.slot).onclick = () => PeopleUI.importFile({});
    $('[data-export]', this.grid.slot).onclick = () => { const rows = this.rows(); PeopleUI.exportPeople(rows, { fileName: this.statusFilter === 'all' ? 'Reach people' : `Reach ${STATUSES[this.statusFilter].label}` }); toast(`Exported ${plural(rows.length, 'person', 'people')}.`); };
    body.appendChild(this.grid.el);
  },

  /* ---------- Bounces ---------- */
  render_bounces(body) {
    const camps = Store.state.campaigns; const campName = id => (camps.find(c => c.id === id) || {}).name || '';
    this.grid = new Grid({
      storageKey: 'bounces', rows: this.rows(), rowHeight: 38, searchPlaceholder: 'Search address, reason…', searchText: b => `${b.email} ${b.reason} ${b.type} ${campName(b.campaign_id)}`, sort: { key: 'bounced_at', dir: -1 }, openable: false,
      columns: [
        { key: '_check', width: '36px' },
        { key: 'email', label: 'Address', width: 'minmax(220px,300px)', editable: true },
        { key: 'type', label: 'Type', type: 'select', width: '96px', editable: true, options: [{ value: 'hard', label: 'Hard' }, { value: 'soft', label: 'Soft' }], render: b => `<span class="pill" style="--c:${b.type === 'soft' ? 'var(--amber)' : 'var(--red)'}">${b.type === 'soft' ? 'Soft' : 'Hard'}</span>` },
        { key: 'reason', label: 'Reason', width: 'minmax(200px,1fr)', editable: true },
        { key: 'bounced_at', label: 'Date', type: 'date', width: '120px', editable: true },
        { key: 'campaign_id', label: 'Campaign', type: 'select', width: '180px', editable: true, options: [{ value: '', label: '— none —' }, ...camps.map(c => ({ value: c.id, label: c.name }))], sortVal: b => campName(b.campaign_id) },
        { key: 'count', label: 'Times', type: 'number', width: '80px', align: 'right' },
        { key: 'domain', label: 'Domain', width: '150px' },
        { key: 'source', label: 'Source', width: '90px' },
      ],
      onEdit: (b, col, val) => {
        const patch = {};
        if (col.key === 'email') { const n = normEmail(val); if (!n.valid) return toast(`Not an email address: ${val}`, 'warn'); if (Store.state.bounces.some(x => x !== b && x.email === n.email)) return toast('That address is already in the bounce list.', 'warn'); patch.email = n.email; patch.domain = emailDomain(n.email); }
        else patch[col.key] = val;
        const tx = Store.begin(['bounces']); Object.assign(b, patch); Store.index = null;
        Store.commit(tx, { label: `Edited bounce ${b.email}`, silent: true, quiet: true }); this.grid.refresh();
      },
      bulk: [
        { label: 'Unblock', icon: 'check', fn: async (ids, g) => { if (!(await uiConfirm({ title: `Unblock ${ids.length} ${ids.length === 1 ? 'address' : 'addresses'}?`, message: 'They go to the trash for 30 days and will no longer be flagged as bounced. Only do this for a genuine mistake — a bounced address usually stays dead.', confirmLabel: 'Unblock', danger: true }))) return; const tx = Store.begin(['bounces', 'trash']); Store.trashRecords('bounces', ids); await Store.commit(tx, { label: `Unblocked ${ids.length} bounced addresses`, type: 'delete' }); g.clearSelection(); } },
        { label: 'Set hard', icon: 'ban', fn: async (ids, g) => { const tx = Store.begin(['bounces']); for (const b of Store.state.bounces) if (ids.includes(b.id)) b.type = 'hard'; Store.index = null; await Store.commit(tx, { label: `Set ${ids.length} bounces to hard` }); g.clearSelection(); } },
        { label: 'Set soft', icon: 'alert', fn: async (ids, g) => { const tx = Store.begin(['bounces']); for (const b of Store.state.bounces) if (ids.includes(b.id)) b.type = 'soft'; Store.index = null; await Store.commit(tx, { label: `Set ${ids.length} bounces to soft` }); g.clearSelection(); } },
        { label: 'Attach to campaign', icon: 'rocket', fn: (ids, g) => openMenu($('[data-bulk="3"]', g.bulk), [{ label: '— none —', fn: () => setCamp('') }, ...camps.map(c => ({ label: c.name, fn: () => setCamp(c.id) }))]) },
      ],
      empty: emptyState({ icon: 'mailx', title: 'No bounces yet', text: 'After a send, paste the bounce notifications in Bounces. Every address lands here and is blocked forever.' }),
    });
    const setCamp = async id => { const ids = this.grid.getSelected(); const tx = Store.begin(['bounces']); for (const b of Store.state.bounces) if (ids.includes(b.id)) b.campaign_id = id; await Store.commit(tx, { label: `Attached ${ids.length} bounces to a campaign` }); this.grid.clearSelection(); };
    this.grid.slot.innerHTML = `<span class="small muted">Hard bounces block forever; soft ones are “your call”.</span><span class="grow"></span><button class="btn btn-ghost btn-sm" data-addb>${icon('plus', 'ic-sm')}Add bounces</button><button class="btn btn-ghost btn-sm" data-export>${icon('download', 'ic-sm')}Export</button>`;
    $('[data-addb]', this.grid.slot).onclick = () => App.go('bounces', 'new');
    $('[data-export]', this.grid.slot).onclick = () => { const aoa = [['Email', 'Type', 'Reason', 'Date', 'Campaign', 'Times', 'Source']]; for (const b of Store.state.bounces) aoa.push([b.email, b.type, b.reason, b.bounced_at, campName(b.campaign_id), b.count, b.source]); writeAOA({ aoa, format: Store.state.settings.exportFormat, fileName: `Reach bounces ${stamp()}`, sheetName: 'Bounced' }); };
    body.appendChild(this.grid.el);
  },

  /* ---------- Mailed ---------- */
  render_mailed(body) {
    const camps = Store.state.campaigns; const campNames = l => (l.campaigns || []).map(id => (camps.find(c => c.id === id) || {}).name).filter(Boolean);
    this.grid = new Grid({
      storageKey: 'mailed', rows: this.rows(), rowHeight: 38, searchPlaceholder: 'Search address or domain…', searchText: l => `${l.email} ${l.domain} ${campNames(l).join(' ')}`, sort: { key: 'last', dir: -1 }, openable: false,
      columns: [
        { key: '_check', width: '36px' },
        { key: 'email', label: 'Address', width: 'minmax(220px,320px)' },
        { key: 'domain', label: 'Domain', width: '170px' },
        { key: 'first', label: 'First mailed', type: 'date', width: '125px', editable: true },
        { key: 'last', label: 'Last mailed', type: 'date', width: '125px', editable: true },
        { key: 'count', label: 'Times', type: 'number', width: '80px', align: 'right', editable: true },
        { key: 'campaigns', label: 'Campaigns', width: 'minmax(200px,1fr)', render: l => `<span class="clip">${campNames(l).map(n => esc(n)).join(', ') || '<span class="muted">—</span>'}</span>`, sortVal: l => campNames(l).join(',') },
      ],
      onEdit: (l, col, val) => { const tx = Store.begin(['ledger']); l[col.key] = val; if (col.key === 'first' && val > l.last) l.last = val; Store.index = null; Store.commit(tx, { label: `Edited mailed record ${l.email}`, silent: true, quiet: true }); this.grid.refresh(); },
      bulk: [{ label: 'Forget', icon: 'trash', fn: async (ids, g) => { if (!(await uiConfirm({ title: `Forget ${ids.length} ${ids.length === 1 ? 'address' : 'addresses'}?`, message: 'Reach will no longer know you mailed them. They go to the trash for 30 days.', confirmLabel: 'Forget', danger: true }))) return; const tx = Store.begin(['ledger', 'trash']); Store.trashRecords('ledger', ids); await Store.commit(tx, { label: `Forgot ${ids.length} mailed addresses`, type: 'delete' }); g.clearSelection(); } }],
      empty: emptyState({ icon: 'send', title: 'Nothing mailed yet', text: 'After you download a clean list and send it, press “I sent this list”. The bare addresses land here (no names, no notes) so the next list is checked against them.' }),
    });
    this.grid.slot.innerHTML = `<span class="small muted">Bare addresses and dates only.</span><span class="grow"></span><button class="btn btn-ghost btn-sm" data-addm>${icon('plus', 'ic-sm')}Mark addresses as mailed</button><button class="btn btn-ghost btn-sm" data-export>${icon('download', 'ic-sm')}Export</button>`;
    $('[data-addm]', this.grid.slot).onclick = () => {
      const m = openModal({ title: 'Mark addresses as mailed', sub: 'For lists you sent before Reach existed. Paste the addresses (or a whole column) and the date you sent them.', body: `<textarea class="textarea paste mono" id="mm-text" placeholder="one address per line, or anything with addresses in it" autofocus></textarea><div class="form-grid mt-2"><div class="field"><label>Sent on</label><input class="input sm" type="date" id="mm-date" value="${todayISO()}"></div><div class="field"><label>Campaign name <span class="muted">(optional)</span></label><input class="input sm" id="mm-name" placeholder="e.g. DMC list, March"></div></div>`, foot: `<button class="btn btn-quiet" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Remember</button>` });
      $('[data-cancel]', m).onclick = () => closeModal(m);
      $('[data-ok]', m).onclick = async () => { const ex = extractEmails($('#mm-text', m).value); if (!ex.valid.length) return toast('No addresses found.', 'warn'); const date = $('#mm-date', m).value || todayISO(), name = $('#mm-name', m).value.trim(); const tx = Store.begin(['ledger', 'campaigns']); let cid = ''; if (name) cid = Store.addCampaign({ name, date, file: 'manual', rows: ex.valid.length, ready: ex.valid.length, sent: ex.valid.length }).id; const r = Store.rememberSent(ex.valid, { campaignId: cid, date }); await Store.commit(tx, { label: `Marked ${ex.valid.length} addresses as mailed`, type: 'sent', text: `Marked ${fmtN(ex.valid.length)} addresses as mailed on ${fmtDate(date)}${name ? ` (${name})` : ''}.` }); closeModal(m); toast(`${r.created} new, ${r.updated} updated.`); };
    };
    $('[data-export]', this.grid.slot).onclick = () => { const aoa = [['Email', 'Domain', 'First mailed', 'Last mailed', 'Times', 'Campaigns']]; for (const l of Store.state.ledger) aoa.push([l.email, l.domain, l.first, l.last, l.count, campNames(l).join(', ')]); writeAOA({ aoa, format: Store.state.settings.exportFormat, fileName: `Reach mailed ${stamp()}`, sheetName: 'Mailed' }); };
    body.appendChild(this.grid.el);
  },

  /* ---------- Campaigns ---------- */
  render_campaigns(body) {
    const stats = c => Store.campaignStats(c);
    this.grid = new Grid({
      storageKey: 'campaigns', rows: this.rows(), rowHeight: 40, searchPlaceholder: 'Search campaigns…', searchText: c => `${c.name} ${c.file} ${c.note}`, sort: { key: 'date', dir: -1 },
      columns: [
        { key: '_check', width: '36px' }, { key: '_open', width: '34px' },
        { key: 'name', label: 'Campaign', width: 'minmax(180px,260px)', editable: true },
        { key: 'date', label: 'Sent on', type: 'date', width: '120px', editable: true },
        { key: 'sent', label: 'Sent', type: 'number', width: '80px', align: 'right' },
        { key: 'bounced', label: 'Bounced', width: '110px', align: 'right', get: c => stats(c).bounced, render: c => { const s = stats(c); return `<span class="num">${fmtN(s.bounced)}</span>${c.sent ? `<span class="cell-sub">${(100 * s.bounceRate).toFixed(1)}%</span>` : ''}`; } },
        { key: 'replies', label: 'Replies', width: '100px', align: 'right', get: c => stats(c).replies, render: c => { const s = stats(c); return `<span class="num">${fmtN(s.replies)}</span>${c.sent ? `<span class="cell-sub">${(100 * s.replyRate).toFixed(1)}%</span>` : ''}`; } },
        { key: 'rows', label: 'Rows', type: 'number', width: '80px', align: 'right' },
        { key: 'block', label: 'Blocked', type: 'number', width: '90px', align: 'right' },
        { key: 'ask', label: 'Your call', type: 'number', width: '90px', align: 'right' },
        { key: 'file', label: 'File', width: '180px' },
        { key: 'note', label: 'Note', type: 'note', width: 'minmax(200px,1fr)', editable: true },
      ],
      onEdit: (c, col, val) => { const tx = Store.begin(['campaigns']); c[col.key] = val; Store.commit(tx, { label: `Edited campaign ${c.name}`, silent: true, quiet: true }); this.grid.refresh(); },
      onOpen: c => this.openCampaign(c.id),
      bulk: [{ label: 'Delete', icon: 'trash', fn: async (ids, g) => { if (!(await uiConfirm({ title: `Delete ${ids.length} ${ids.length === 1 ? 'campaign' : 'campaigns'}?`, message: 'The mailed addresses stay in memory (you did send them). Only the campaign record goes to the trash.', confirmLabel: 'Delete', danger: true }))) return; const tx = Store.begin(['campaigns', 'trash']); Store.trashRecords('campaigns', ids); await Store.commit(tx, { label: `Deleted ${ids.length} campaigns`, type: 'delete' }); g.clearSelection(); } }],
      empty: emptyState({ icon: 'rocket', title: 'No campaigns yet', text: 'A campaign is created every time you press “I sent this list” after a screening.' }),
    });
    this.grid.slot.innerHTML = `<span class="grow"></span><button class="btn btn-ghost btn-sm" data-export>${icon('download', 'ic-sm')}Export</button>`;
    $('[data-export]', this.grid.slot).onclick = () => { const aoa = [['Campaign', 'Sent on', 'Sent', 'Bounced', 'Bounce %', 'Replies', 'Reply %', 'Rows', 'Blocked', 'Your call', 'File', 'Note']]; for (const c of Store.state.campaigns) { const s = stats(c); aoa.push([c.name, c.date, c.sent, s.bounced, (100 * s.bounceRate).toFixed(1), s.replies, (100 * s.replyRate).toFixed(1), c.rows, c.block, c.ask, c.file, c.note]); } writeAOA({ aoa, format: Store.state.settings.exportFormat, fileName: `Reach campaigns ${stamp()}`, sheetName: 'Campaigns' }); };
    body.appendChild(this.grid.el);
  },
  openCampaign(id) {
    const c = Store.state.campaigns.find(x => x.id === id); if (!c) return;
    const s = Store.campaignStats(c);
    const bounces = Store.state.bounces.filter(b => b.campaign_id === c.id);
    const replies = Store.state.people.filter(p => (p.history || []).some(h => h.campaign === c.id && h.type === 'reply'));
    const d = openDrawer({ title: c.name, sub: `Sent ${fmtDate(c.date)} · from ${esc(c.file || '—')}`, body: `
      <div class="grid-2" style="gap:.6rem">${statTile({ label: 'Sent', value: fmtN(c.sent), color: 'var(--blue)' })}${statTile({ label: 'Bounced', value: fmtN(s.bounced), sub: c.sent ? `${(100 * s.bounceRate).toFixed(1)}% of sent` : '', color: 'var(--red)' })}${statTile({ label: 'Replies', value: fmtN(s.replies), sub: c.sent ? `${(100 * s.replyRate).toFixed(1)}% of sent` : '', color: 'var(--green)' })}${statTile({ label: 'Screened out', value: fmtN(c.block + c.ask), sub: `${fmtN(c.block)} blocked · ${fmtN(c.ask)} your call`, color: 'var(--amber)' })}</div>
      <div class="section"><h4>Note</h4><textarea class="textarea" data-note placeholder="What was this list, what went well…">${esc(c.note || '')}</textarea></div>
      <div class="section"><h4>Replies (${replies.length})</h4>${replies.length ? `<div class="list-rows">${replies.map(p => `<button class="list-row click" data-open-person="${p.id}"><span class="avatar">${initials(personLabel(p))}</span><span class="grow clip"><b>${esc(personLabel(p))}</b></span>${statusChip(p.status, { sm: true })}</button>`).join('')}</div>` : '<div class="small muted">No replies logged for this campaign yet.</div>'}</div>
      <div class="section"><h4>Bounced (${bounces.length})</h4>${bounces.length ? `<div class="small" style="max-height:220px;overflow:auto">${bounces.slice(0, 200).map(b => `<div class="row between"><code>${esc(b.email)}</code><span class="pill" style="--c:${b.type === 'soft' ? 'var(--amber)' : 'var(--red)'}">${b.type}</span></div>`).join('')}${bounces.length > 200 ? `<div class="muted">+${bounces.length - 200} more</div>` : ''}</div>` : '<div class="small muted">No bounces attached. Paste them in Bounces and pick this campaign.</div>'}</div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-reply>${icon('reply', 'ic-sm')}Log a reply</button><button class="btn btn-ghost btn-sm" data-bounce>${icon('mailx', 'ic-sm')}Add bounces</button><span class="grow"></span><button class="btn btn-danger-ghost btn-sm" data-del>${icon('trash', 'ic-sm')}Delete</button>` });
    $('[data-note]', d).onchange = e => { const tx = Store.begin(['campaigns']); c.note = e.target.value; Store.commit(tx, { label: `Edited note on ${c.name}`, silent: true, quiet: true }); };
    $$('[data-open-person]', d).forEach(b => b.onclick = () => PeopleUI.open(b.dataset.openPerson));
    $('[data-reply]', d).onclick = () => PeopleUI.logReply({ campaignId: c.id });
    $('[data-bounce]', d).onclick = () => { closeDrawer(); BouncesView.reset(); BouncesView.s.campaignId = c.id; App.go('bounces'); };
    $('[data-del]', d).onclick = async () => { if (!(await uiConfirm({ title: `Delete ${c.name}?`, message: 'The mailed addresses stay in memory. Only the campaign record goes to the trash.', confirmLabel: 'Delete', danger: true }))) return; const tx = Store.begin(['campaigns', 'trash']); Store.trashRecords('campaigns', [c.id]); await Store.commit(tx, { label: `Deleted campaign ${c.name}`, type: 'delete' }); closeDrawer(); };
  },

  /* ---------- Trash ---------- */
  render_trash(body) {
    const t = Store.state.trash; const days = Store.state.settings.trashDays || 30;
    const label = x => x.coll === 'people' ? personLabel(x.record) : x.coll === 'campaigns' ? x.record.name : x.record.email;
    const kind = { people: 'Person', bounces: 'Bounce', ledger: 'Mailed address', campaigns: 'Campaign' };
    body.innerHTML = `<div class="card">${t.length ? `<div class="card-head"><h3>${plural(t.length, 'item')} in the trash</h3><div class="row"><button class="btn btn-ghost btn-sm" data-restore-all>${icon('undo', 'ic-sm')}Restore all</button><button class="btn btn-danger-ghost btn-sm" data-empty>${icon('trash', 'ic-sm')}Empty trash</button></div></div>
      <div class="table-wrap" style="border:none;border-radius:0"><table class="table"><thead><tr><th>Type</th><th>Item</th><th>Deleted</th><th>Expires</th><th></th></tr></thead><tbody>${t.map(x => `<tr><td><span class="pill">${kind[x.coll] || x.coll}</span></td><td><b>${esc(label(x))}</b>${x.coll === 'people' ? `<div class="sub">${esc(personSub(x.record))}</div>` : ''}</td><td class="small muted">${fmtDateTime(x.deleted_at)}</td><td class="small muted">in ${Math.max(0, days - (daysBetween(x.deleted_at, todayISO()) || 0))} days</td><td class="right nowrap"><button class="btn btn-ghost btn-xs" data-restore="${x.id}">Restore</button> <button class="btn btn-quiet btn-xs" data-forever="${x.id}">Delete forever</button></td></tr>`).join('')}</tbody></table></div>` : emptyState({ icon: 'trash', title: 'The trash is empty', text: `Deleted people, bounces, mailed addresses and campaigns wait here for ${days} days before they are gone for good.` })}</div>`;
    $$('[data-restore]', body).forEach(b => b.onclick = async () => { const tx = Store.begin(['people', 'bounces', 'ledger', 'campaigns', 'trash']); const r = Store.restoreTrash([b.dataset.restore]); await Store.commit(tx, { label: `Restored ${r.map(label).join(', ')}`, type: 'restore' }); });
    $$('[data-forever]', body).forEach(b => b.onclick = async () => { if (!(await uiConfirm({ title: 'Delete forever?', message: 'This cannot be undone.', confirmLabel: 'Delete forever', danger: true }))) return; const tx = Store.begin(['trash']); Store.state.trash = Store.state.trash.filter(x => x.id !== b.dataset.forever); await Store.commit(tx, { label: 'Deleted an item forever', type: 'delete', undoable: false }); });
    const ra = $('[data-restore-all]', body); if (ra) ra.onclick = async () => { const tx = Store.begin(['people', 'bounces', 'ledger', 'campaigns', 'trash']); const r = Store.restoreTrash(t.map(x => x.id)); await Store.commit(tx, { label: `Restored ${r.length} items from the trash`, type: 'restore' }); };
    const em = $('[data-empty]', body); if (em) em.onclick = async () => { if (!(await uiConfirm({ title: 'Empty the trash?', message: `${plural(t.length, 'item')} will be gone for good. This cannot be undone.`, confirmLabel: 'Empty trash', danger: true, typed: 'EMPTY' }))) return; const tx = Store.begin(['trash']); Store.state.trash = []; await Store.commit(tx, { label: 'Emptied the trash', type: 'delete', undoable: false }); };
  },

  /* ---------- Activity ---------- */
  render_activity(body) {
    const types = { screen: 'shield', sent: 'send', bounce: 'mailx', reply: 'reply', add: 'plus', import: 'upload', edit: 'edit', delete: 'trash', restore: 'undo', undo: 'undo', redo: 'redo', settings: 'settings', cloud: 'cloud', snapshot: 'history' };
    const all = Store.state.activity; const f = this.activityFilter;
    const rows = f === 'all' ? all : all.filter(a => a.type === f);
    body.innerHTML = `<div class="card"><div class="card-head"><h3>What happened, newest first</h3><select class="select sm" id="act-f" style="width:auto"><option value="all">Everything</option>${Object.keys(types).map(t => `<option value="${t}" ${f === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div><div class="card-pad" style="padding-top:.3rem">${rows.length ? `<ul class="feed">${rows.slice(0, 300).map(a => `<li><span class="fi">${icon(types[a.type] || 'info', 'ic-sm')}</span><span class="grow">${esc(a.text)}</span><span class="when">${fmtDateTime(a.ts)}</span></li>`).join('')}</ul>` : '<div class="small muted">Nothing yet.</div>'}</div></div>`;
    $('#act-f', body).onchange = e => { this.activityFilter = e.target.value; this.render_activity(body); };
  },
};
App.register('sheets', SheetsView);
