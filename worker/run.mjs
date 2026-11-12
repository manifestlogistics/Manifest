// Manifest worker. Runs every few minutes on GitHub Actions.
// 1) read replies  2) flag silence  3) send due check-ins  4) forward support messages
import { HR, LABELS, buildCheckin, tagFrom, cleanReply, classify, isAuto, isBounce, isSilent, nextCheckin, agoText, validEmail, clean } from './lib.mjs';

export function makeDb(url, key, f = globalThis.fetch) {
  const legacy = String(key).startsWith('eyJ');
  const hdr = extra => ({ apikey: key, ...(legacy ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json', ...extra });
  async function call(path, { method = 'GET', body, prefer } = {}, base = '/rest/v1/') {
    const r = await f(url + base + path, { method, headers: hdr(prefer ? { Prefer: prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} failed (${r.status}): ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  }
  return {
    get: p => call(p),
    post: (p, b, prefer = 'return=minimal') => call(p, { method: 'POST', body: b, prefer }),
    patch: (p, b) => call(p, { method: 'PATCH', body: b, prefer: 'return=minimal' }),
    user: id => call('users/' + id, {}, '/auth/v1/admin/'),
  };
}

const iso = ms => new Date(ms).toISOString();
const inList = ids => '(' + ids.join(',') + ')';

export async function main(env, deps) {
  const now = (deps && deps.now) || Date.now();
  const db = deps.db, mailer = deps.mailer;
  const site = (env.SITE_URL || 'https://manifestlogistics.app').replace(/\/$/, '');
  const gmail = env.GMAIL_USER, admin = env.ADMIN_EMAIL || gmail;
  const log = deps.log || console.log;
  const stat = { replies: 0, bounces: 0, silent: 0, sent: 0, tickets: 0, errors: 0 };
  const emails = {};
  const ownerEmail = async id => { if (!(id in emails)) { try { emails[id] = ((await db.user(id)) || {}).email || ''; } catch (e) { emails[id] = ''; } } return emails[id]; };
  const sendMail = async m => { if (env.DRY_RUN) { log('[dry run] would email', m.to, '|', m.subject); return; } await mailer.send(m); };
  const alertOwner = async (ship, kind, key, subject, text) => {
    // Each alert is only ever sent once, because the database refuses a duplicate.
    const made = await db.post('alerts?on_conflict=shipment_id,kind,text', { owner: ship.owner, shipment_id: ship.id, kind, text: key }, 'resolution=ignore-duplicates,return=representation');
    if (!made || !made.length) return false;
    const to = await ownerEmail(ship.owner);
    if (to) await sendMail({ from: { name: 'Manifest alerts', address: gmail }, to, subject, text: text + `\n\nOpen Manifest: ${site}/app/\n\nYou are getting this because you track shipments with Manifest.` });
    return true;
  };
  const addMsg = (ship, kind, body, direction = 'out') => db.post('messages', { owner: ship.owner, shipment_id: ship.id, direction, channel: 'email', kind, body });
  const dir = async ship => (await db.get(`transporters?select=*&id=eq.${ship.transporter_id}`))[0] || null;

  /* 1. replies */
  if (deps.inbox) {
    for (const m of await deps.inbox.unread()) {
      try {
        const tag = tagFrom(m);
        if (!tag) { await deps.inbox.seen(m.uid); continue; }
        const ship = (await db.get(`shipments?select=*&reply_token=like.${tag}*&limit=1`))[0];
        if (!ship || ship.archived) { await deps.inbox.seen(m.uid); continue; }
        const t = ship.transporter_id ? await dir(ship) : null;
        const name = (t && t.name) || 'the transporter';
        if (isBounce(m)) {
          await addMsg(ship, 'warn', `Our email to ${name} could not be delivered. Please check their email address.`);
          await alertOwner(ship, 'bounce', 'bounce-' + (m.messageId || m.uid), `Manifest: email to ${name} bounced (${ship.ref})`, `Our update request for ${ship.ref} could not be delivered to ${name}. Please check the email address in Contacts.`);
          stat.bounces++; await deps.inbox.seen(m.uid); continue;
        }
        if (isAuto(m)) { await deps.inbox.seen(m.uid); continue; }
        const said = cleanReply(m.text);
        const status = classify(said);
        const locked = ['delivered', 'cancelled'].includes(ship.status);
        await addMsg(ship, 'reply', `Reply: "${said || '(no text)'}"`, 'in');
        const upd = { last_reply: iso(now) };
        if (!locked && said) {
          upd.status = status;
          if (status !== ship.status) {
            if (status === 'delayed' || status === 'customs_hold') {
              await addMsg(ship, 'warn', `Status changed to ${LABELS[status]}, based on the reply`);
              await alertOwner(ship, 'late', `${status}-${iso(now).slice(0, 13)}`, `Manifest: ${ship.ref} is ${LABELS[status].toLowerCase()}`, `${name} replied about ${ship.ref}:\n"${said}"\n\nWe marked it as ${LABELS[status]}.`);
            } else if (status === 'delivered') await addMsg(ship, 'rep', 'Marked as Delivered');
          }
        }
        await db.patch(`shipments?id=eq.${ship.id}`, upd);
        stat.replies++; await deps.inbox.seen(m.uid);
      } catch (e) { stat.errors++; log('reply error:', e.message); }
    }
  }

  /* 2. replies that never came */
  try {
    const rows = await db.get(`shipments?select=*&archived=eq.false&status=not.in.(delivered,cancelled)&last_checkin=lt.${encodeURIComponent(iso(now - 24 * HR))}&limit=500`);
    for (const s of rows || []) {
      try {
        if (!isSilent(s, now)) continue;
        const t = s.transporter_id ? await dir(s) : null; const name = (t && t.name) || 'the transporter';
        const sent = await alertOwner(s, 'silent', 'asked-' + s.last_checkin, `Manifest: no reply about ${s.ref}`, `${name} has not replied about ${s.ref} for ${agoText(now - new Date(s.last_checkin).getTime())}.\n\nYou may want to call them.`);
        if (sent) { await addMsg(s, 'warn', `No reply from ${name} for ${agoText(now - new Date(s.last_checkin).getTime())}. You may want to call them.`); stat.silent++; }
      } catch (e) { stat.errors++; log('silence error:', e.message); }
    }
  } catch (e) { stat.errors++; log('silence check failed:', e.message); }

  /* 3. check-ins that are due */
  try {
    const dayCount = ((await db.get(`messages?select=id&kind=eq.sent&created_at=gte.${encodeURIComponent(iso(now - 24 * HR))}&limit=1000`)) || []).length;
    let room = Math.max(0, 420 - dayCount); // stay well under Gmail's daily limit
    const due = (await db.get(`shipments?select=*&archived=eq.false&status=not.in.(delivered,cancelled)&next_checkin=lte.${encodeURIComponent(iso(now))}&order=next_checkin.asc&limit=60`)) || [];
    if (due.length) {
      const tids = [...new Set(due.map(s => s.transporter_id).filter(Boolean))], oids = [...new Set(due.map(s => s.owner))];
      const trs = tids.length ? await db.get(`transporters?select=*&id=in.${inList(tids)}`) : [];
      const prs = await db.get(`profiles?select=id,business_name,settings&id=in.${inList(oids)}`);
      for (const s of due) {
        try {
          const t = trs.find(x => x.id === s.transporter_id), p = prs.find(x => x.id === s.owner) || {};
          if (!t || !validEmail(t.email)) { await db.patch(`shipments?id=eq.${s.id}`, { next_checkin: nextCheckin(now, s.freq_hours) }); continue; }
          if (room <= 0) { log('daily email limit reached, waiting'); break; }
          const mail = buildCheckin({ site, gmail, ship: s, transporter: t, profile: p });
          await sendMail({ from: mail.from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html });
          room--;
          await addMsg(s, 'sent', `Asked for an update by email to ${t.name}${mail.lang !== 'English' ? ' in ' + mail.lang : ''}`);
          await db.patch(`shipments?id=eq.${s.id}`, { last_checkin: iso(now), next_checkin: nextCheckin(now, s.freq_hours), ...(s.status === 'in_transit' ? { status: 'pending' } : {}) });
          stat.sent++;
        } catch (e) { stat.errors++; log('send error:', s.ref, e.message); }
      }
    }
  } catch (e) { stat.errors++; log('check-in step failed:', e.message); }

  /* 4. support messages go to the founder */
  try {
    const ts = (await db.get('tickets?select=*&notified=eq.false&order=created_at.asc&limit=30')) || [];
    for (const k of ts) {
      try {
        const who = await ownerEmail(k.owner);
        await sendMail({ from: { name: 'Manifest support', address: gmail }, to: admin, replyTo: who || undefined, subject: `Manifest support: ${clean(k.subject)}`, text: `From: ${who || k.owner}\nCategory: ${k.category}\nUrgency: ${k.urgency}\n\n${k.body || ''}` });
        await db.patch(`tickets?id=eq.${k.id}`, { notified: true }); stat.tickets++;
      } catch (e) { stat.errors++; log('ticket error:', e.message); }
    }
  } catch (e) { stat.errors++; log('ticket step failed:', e.message); }

  log('done', JSON.stringify(stat));
  return stat;
}

/* run for real when started from the command line */
if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const env = process.env;
  const need = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'].filter(k => !env[k]);
  if (need.length) { console.error('Missing settings: ' + need.join(', ') + '. Add them in GitHub: Settings, Secrets and variables, Actions.'); process.exit(1); }
  const { makeMailer, makeInbox } = await import('./mail.mjs');
  const db = makeDb(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  let mailer = null, inbox = null;
  try { mailer = await makeMailer(env.GMAIL_USER, env.GMAIL_APP_PASSWORD); } catch (e) { console.error('Could not set up sending:', e.message); }
  try { inbox = await makeInbox(env.GMAIL_USER, env.GMAIL_APP_PASSWORD); } catch (e) { console.error('Could not open the inbox:', e.message); }
  try { const s = await main(env, { db, mailer, inbox }); if (!inbox && !mailer) process.exitCode = 1; }
  finally { try { inbox && await inbox.close(); } catch (e) {} try { mailer && mailer.close(); } catch (e) {} }
}
