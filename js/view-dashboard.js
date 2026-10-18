/* =============================================================================
   Reach — Dashboard: where things stand, what needs doing, memory health.
   ============================================================================= */
'use strict';

const DashboardView = {
  render(root) {
    const s = Store.state, st = s.settings, today = todayISO();
    const by = {}; for (const p of s.people) by[p.status] = (by[p.status] || 0) + 1;
    const h = new Date().getHours(); const greet = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const camps = s.campaigns.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    const last = camps[0];
    const totalSent = camps.reduce((a, c) => a + (c.sent || 0), 0);
    const due = this.followUps(today);
    const health = this.health();
    root.innerHTML = `
      <div class="page-head"><div><div class="mono eyebrow">${fmtDate(today)}</div><h1>${greet}, ${esc(st.name || 'there')}.</h1><p class="lede">${this.headline(by, due, last)}</p></div>
        <div class="page-actions"><button class="btn btn-ghost btn-sm" data-reply>${icon('reply', 'ic-sm')}Log a reply</button><button class="btn btn-ghost btn-sm" data-add>${icon('plus', 'ic-sm')}Add to memory</button></div></div>
      <div class="hero-actions mb-3">
        <button class="hero-action" data-go="screen"><span class="ha-ic">${icon('shield', 'ic-lg')}</span><b>Screen a list</b><span>Drop the sheet you are about to send. See who you already know, download the clean list.</span></button>
        <button class="hero-action" data-go="bounces"><span class="ha-ic">${icon('mailx', 'ic-lg')}</span><b>Remove bounces</b><span>Paste the bounce notifications after a send. Blocked forever, list cleaned.</span></button>
        <button class="hero-action" data-go="sheets"><span class="ha-ic">${icon('sheet', 'ic-lg')}</span><b>Open the sheets</b><span>${fmtN(s.people.length)} people, ${fmtN(s.bounces.length)} bounces, ${fmtN(s.ledger.length)} mailed — all editable.</span></button>
      </div>
      <div class="grid-4 mb-3">
        ${statTile({ label: 'Clients', value: fmtN(by.client || 0), sub: `${fmtN(by.past || 0)} past`, color: 'var(--s-client)', onClickAttr: 'data-go="sheets/people"' })}
        ${statTile({ label: 'In play', value: fmtN((by.warm || 0) + (by.pipeline || 0)), sub: `${fmtN(by.warm || 0)} warm · ${fmtN(by.pipeline || 0)} in pipeline`, color: 'var(--s-warm)', onClickAttr: 'data-go="sheets/people"' })}
        ${statTile({ label: 'Blocked addresses', value: fmtN(s.bounces.length + s.people.reduce((a, p) => a + p.emails.length, 0)), sub: `${fmtN(s.bounces.length)} bounced · ${fmtN(s.people.reduce((a, p) => a + p.emails.length, 0))} known people`, color: 'var(--red)', onClickAttr: 'data-go="sheets/bounces"' })}
        ${statTile({ label: 'Mailed', value: fmtN(s.ledger.length), sub: last ? `last send ${relTime(last.date)} · ${fmtN(camps.length)} campaigns` : 'no campaigns yet', color: 'var(--blue)', onClickAttr: 'data-go="sheets/mailed"' })}
      </div>
      <div class="grid-3 mb-3">
        <div class="card span-2"><div class="card-head"><h3>Memory mix</h3><span class="small muted">${plural(s.people.length, 'person', 'people')}</span></div><div class="card-pad">${s.people.length ? mixBar(STATUS_KEYS.map(k => ({ label: STATUSES[k].label, value: by[k] || 0, color: STATUSES[k].color }))) : '<div class="small muted">Nothing in memory yet. Import your client list from Sheets.</div>'}
          ${camps.length ? `<div class="sep"></div><div class="row between mb-2"><b class="small">Campaigns</b><span class="small muted">${fmtN(totalSent)} addresses sent in total</span></div>${barList(camps.slice(0, 6).map(c => { const cs = Store.campaignStats(c); return { label: c.name, value: c.sent, display: `${fmtN(c.sent)} · ${cs.bounced ? (100 * cs.bounceRate).toFixed(1) + '% bounced' : 'no bounces'}${cs.replies ? ` · ${cs.replies} ${cs.replies === 1 ? 'reply' : 'replies'}` : ''}`, color: cs.bounceRate > 0.05 ? 'var(--red)' : 'var(--blue)' }; }))}` : ''}
        </div></div>
        <div class="card"><div class="card-head"><h3>Follow-ups</h3><span class="small muted">${due.length ? plural(due.length, 'due') : 'none due'}</span></div><div class="card-pad due-list" style="padding-top:.5rem">${due.length ? `<div class="list-rows">${due.slice(0, 8).map(d => `<button class="list-row click" data-open-person="${d.p.id}"><span class="avatar">${initials(personLabel(d.p))}</span><span class="grow clip"><b>${esc(personLabel(d.p))}</b><div class="tiny muted clip">${esc(d.why)}</div></span>${statusChip(d.p.status, { sm: true, dot: false })}</button>`).join('')}${due.length > 8 ? `<div class="small muted center">+${due.length - 8} more in Sheets</div>` : ''}</div>` : `<div class="small muted">Set a <b>revisit date</b> on a Not now, or keep Warm leads moving, and they show up here when it is time.</div>`}</div></div>
      </div>
      <div class="grid-3">
        <div class="card span-2"><div class="card-head"><h3>Memory health</h3><span class="small muted">${health.length ? plural(health.length, 'suggestion') : 'all tidy'}</span></div><div class="card-pad" style="padding-top:.5rem">${health.length ? `<div class="list-rows">${health.map((x, i) => `<div class="list-row" style="align-items:flex-start">${icon(x.icon, 'ic-sm')}<span class="grow small"><b>${esc(x.title)}</b><div class="muted">${x.text}</div></span>${x.action ? `<button class="btn btn-ghost btn-xs" data-health="${i}">${esc(x.action)}</button>` : ''}</div>`).join('')}</div>` : `<div class="small muted">${icon('checkc', 'ic-sm')} No duplicates, no bounced client addresses, nothing stale. Nice.</div>`}</div></div>
        <div class="card"><div class="card-head"><h3>Recent activity</h3><a class="small" href="#/sheets/activity">All</a></div><div class="card-pad" style="padding-top:.3rem">${s.activity.length ? `<ul class="feed">${s.activity.slice(0, 7).map(a => `<li><span class="grow small">${esc(a.text)}</span><span class="when">${relTime(a.ts)}</span></li>`).join('')}</ul>` : '<div class="small muted">Nothing yet.</div>'}</div></div>
      </div>
      <div class="row mt-4 small muted wrap" style="gap:1rem">${icon('lock', 'ic-sm')}<span>${Store.meta.encrypted ? 'Vault on: everything on this device is encrypted.' : 'Vault off: data is stored unencrypted in this browser. Turn it on in <a href="#/settings/privacy">Settings → Privacy</a>.'}</span>${st.cloud.enabled ? `<span>· Cloud backup ${st.cloud.lastBackup ? 'last ran ' + relTime(st.cloud.lastBackup) : 'not run yet'}.</span>` : '<span>· <a href="#/settings/backups">Download a backup</a> now and then.</span>'}</div>`;
    $$('[data-go]', root).forEach(b => b.onclick = () => { const [r, sub] = b.dataset.go.split('/'); App.go(r, sub); });
    $$('[data-open-person]', root).forEach(b => b.onclick = () => PeopleUI.open(b.dataset.openPerson));
    $('[data-reply]', root).onclick = () => PeopleUI.logReply({});
    $('[data-add]', root).onclick = e => openMenu(e.currentTarget, [{ label: 'One person or company', icon: 'user', fn: () => PeopleUI.quickAdd({ status: 'client' }) }, { label: 'Paste many lines', icon: 'paste', fn: () => PeopleUI.pasteMany({ status: 'client' }) }, { label: 'Import a file', icon: 'upload', fn: () => PeopleUI.importFile({}) }], { align: 'right' });
    $$('[data-health]', root).forEach(b => b.onclick = () => health[+b.dataset.health].fn());
  },
  headline(by, due, last) {
    const parts = [];
    parts.push(`<b>${fmtN(by.client || 0)}</b> ${by.client === 1 ? 'client' : 'clients'}, <b>${fmtN((by.warm || 0) + (by.pipeline || 0))}</b> in play, <b>${fmtN(by.notnow || 0)}</b> parked.`);
    if (due.length) parts.push(`<b>${due.length}</b> ${due.length === 1 ? 'follow-up is' : 'follow-ups are'} due.`);
    if (last) parts.push(`Last send: ${esc(last.name)}, ${relTime(last.date)}.`); else parts.push('Screen a list when you are ready to send.');
    return parts.join(' ');
  },
  followUps(today) {
    const out = [], soon = isoOf(new Date(Date.now() + 14 * 86400000));
    for (const p of Store.state.people) {
      if (p.status === 'notnow' && p.revisit_on && p.revisit_on <= soon) out.push({ p, why: p.revisit_on <= today ? `Revisit date ${fmtDate(p.revisit_on)} has passed — reach out again?` : `Revisit on ${fmtDate(p.revisit_on)}`, when: p.revisit_on });
      else if ((p.status === 'warm' || p.status === 'pipeline')) { const lastTouch = [p.last_reply, p.last_contact, p.updated_at.slice(0, 10)].filter(Boolean).sort().pop(); const days = daysBetween(lastTouch, today); if (days != null && days >= 14) out.push({ p, why: `${STATUSES[p.status].label}, quiet for ${days} days — nudge them?`, when: lastTouch }); }
    }
    return out.sort((a, b) => a.when < b.when ? -1 : 1);
  },
  health() {
    const s = Store.state, idx = Store.getIndex(), out = [];
    // bounced addresses that belong to people
    const bouncedPeople = s.people.filter(p => p.emails.some(e => idx.bounces.get(e)));
    if (bouncedPeople.length) out.push({ icon: 'mailx', title: `${bouncedPeople.length} ${bouncedPeople.length === 1 ? 'person has' : 'people have'} an address that bounced`, text: `${bouncedPeople.slice(0, 3).map(p => esc(personLabel(p))).join(', ')}${bouncedPeople.length > 3 ? '…' : ''} — find a working address so you do not lose touch.`, action: 'Open', fn: () => PeopleUI.open(bouncedPeople[0].id) });
    // duplicates by company or domain
    const groups = new Map();
    for (const [k, arr] of idx.byCompany) if (arr.length > 1) groups.set('c:' + k, arr);
    for (const [k, arr] of idx.byDomain) if (arr.length > 1 && !groups.has('c:' + cleanCompany(arr[0].company, idx.suffixes))) groups.set('d:' + k, arr);
    if (groups.size) { const first = [...groups.values()][0]; out.push({ icon: 'merge', title: `${groups.size} possible duplicate ${groups.size === 1 ? 'group' : 'groups'}`, text: `Same company or domain more than once — e.g. ${first.map(p => esc(personLabel(p))).slice(0, 3).join(' / ')}. Merge them if they are the same account, or leave them if they are different contacts.`, action: 'Review', fn: () => PeopleUI.mergeInto(first[0]) }); }
    // company-only records
    const noEmail = s.people.filter(p => !p.emails.length);
    if (noEmail.length) out.push({ icon: 'mail', title: `${noEmail.length} ${noEmail.length === 1 ? 'record has' : 'records have'} no email address`, text: `${noEmail.slice(0, 3).map(p => esc(personLabel(p))).join(', ')} — matched by company name only. Add an address or domain to block them reliably.`, action: 'Open', fn: () => PeopleUI.open(noEmail[0].id) });
    // stale not-now without a revisit date
    const stale = s.people.filter(p => p.status === 'notnow' && !p.revisit_on && (daysBetween(p.updated_at, todayISO()) || 0) > 120);
    if (stale.length) out.push({ icon: 'calendar', title: `${stale.length} Not now ${stale.length === 1 ? 'record is' : 'records are'} over 4 months old with no revisit date`, text: 'Set a revisit date so Reach can remind you, or they stay blocked for ever.', action: 'Set dates', fn: () => App.go('sheets', 'people') });
    // people who are also in the ledger with a free mailbox and a corporate company name
    const vaultOff = !Store.meta.encrypted;
    if (vaultOff && s.people.length > 50) out.push({ icon: 'lock', title: 'Vault lock is off', text: 'Your memory holds client names. Encrypt it at rest with a passphrase.', action: 'Turn on', fn: () => App.go('settings', 'privacy') });
    return out;
  },
};
App.register('dashboard', DashboardView);
