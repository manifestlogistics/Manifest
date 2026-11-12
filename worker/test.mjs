import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, cleanReply, tagFrom, buildCheckin, isSilent, replyTo, silenceHours, isAuto, isBounce } from './lib.mjs';
import { main } from './run.mjs';

test('classify reads simple replies', () => {
  assert.equal(classify('On the way, will arrive tomorrow.'), 'in_transit');
  assert.equal(classify('Delivered today. Signed by the receiver.'), 'delivered');
  assert.equal(classify('Will be delivered tomorrow'), 'in_transit');
  assert.equal(classify('Not yet delivered, truck is late'), 'delayed');
  assert.equal(classify('Truck broke down near Multan. About 1 day late.'), 'delayed');
  assert.equal(classify('Reached the port. Waiting for customs examination.'), 'customs_hold');
  assert.equal(classify('Cleared customs this morning, loading now'), 'in_transit');
  assert.equal(classify(''), 'in_transit');
});

test('cleanReply drops the quoted email', () => {
  const raw = 'Left Karachi, on the road.\n\nOn Tue, 10 Nov 2026 at 09:00, Rahim Imports via Manifest <x@gmail.com> wrote:\n> Hi Rahim\n> could you please';
  assert.equal(cleanReply(raw), 'Left Karachi, on the road.');
  assert.equal(cleanReply('Delayed by weather\n\nSent from my iPhone'), 'Delayed by weather');
  assert.equal(cleanReply('Delayed\n\nOn the way: https://manifestlogistics.app/r/?t=abc&s=moving'), 'Delayed');
});

test('tag is found in the address, subject or bounce text', () => {
  assert.equal(tagFrom({ to: ['manifesttracking.updates+a1b2c3d4e5f6@gmail.com'] }), 'a1b2c3d4e5f6');
  assert.equal(tagFrom({ subject: 'Re: Update request: PO-1 [MF-A1B2C3D4E5F6]' }), 'a1b2c3d4e5f6');
  assert.equal(tagFrom({ text: 'Subject: Update request: PO-1 [MF-a1b2c3d4e5f6]' }), 'a1b2c3d4e5f6');
  assert.equal(tagFrom({ to: ['someone@gmail.com'], subject: 'hello' }), '');
});

test('check-in email: language, links, reply address', () => {
  const ship = { ref: 'PO-5521', reply_token: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', data: { mode: 'import', containerId: 'MSKU4829174' } };
  const profile = { business_name: 'Rahim Imports', settings: { settings: { lang: 'English' } } };
  const m = buildCheckin({ site: 'https://manifestlogistics.app', gmail: 'manifesttracking.updates@gmail.com', ship, transporter: { name: 'Ali', email: 'ali@x.com', language: 'Urdu' }, profile });
  assert.equal(m.lang, 'Urdu');
  assert.match(m.text, /PO-5521/); assert.match(m.text, /MSKU4829174/);
  assert.match(m.text, /https:\/\/manifestlogistics\.app\/r\/\?t=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6&s=delayed/);
  assert.match(m.html, /dir="rtl"/);
  assert.equal(m.replyTo, 'manifesttracking.updates+a1b2c3d4e5f6@gmail.com');
  assert.match(m.subject, /\[MF-a1b2c3d4e5f6\]$/);
  assert.equal(m.from.name, 'Rahim Imports via Manifest');
  // an unknown language goes out in English, and an empty container leaves no "()"
  const e = buildCheckin({ site: 's', gmail: 'a@gmail.com', ship: { ...ship, data: { mode: 'local', vehicle: '' } }, transporter: { name: 'Bo', email: 'b@x.com', language: 'Zulu' }, profile });
  assert.match(e.text, /^Hi Bo, could you please/); assert.doesNotMatch(e.text, /\(\)/);
  // a business's own wording is used as written
  const c = buildCheckin({ site: 's', gmail: 'a@gmail.com', ship, transporter: { name: 'Bo', email: 'b@x.com', language: 'Urdu' }, profile: { business_name: 'X', settings: { settings: { tpl: 'Salam {{transporter_name}}, status of {{shipment_id}}?' } } } });
  assert.match(c.text, /^Salam Bo, status of PO-5521\?/);
});

test('silence rules', () => {
  const now = Date.parse('2026-11-12T12:00:00Z'), h = n => new Date(now - n * 3600e3).toISOString();
  assert.equal(silenceHours(12), 24); assert.equal(silenceHours(168), 48);
  assert.equal(isSilent({ last_checkin: h(30), last_reply: null, freq_hours: 12 }, now), true);
  assert.equal(isSilent({ last_checkin: h(30), last_reply: h(2), freq_hours: 12 }, now), false);
  assert.equal(isSilent({ last_checkin: h(10), last_reply: null, freq_hours: 12 }, now), false);
  assert.equal(isSilent({ last_checkin: null, last_reply: null, freq_hours: 12 }, now), false);
  assert.equal(isSilent({ last_checkin: h(30), last_reply: h(40), freq_hours: 12 }, now), true);
});

test('auto replies and bounces are recognised', () => {
  assert.equal(isBounce({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)' }), true);
  assert.equal(isAuto({ from: 'a@b.com', subject: 'Out of office: back Monday', headers: {} }), true);
  assert.equal(isAuto({ from: 'a@b.com', subject: 'Re: update', headers: { 'auto-submitted': 'auto-replied' } }), true);
  assert.equal(isAuto({ from: 'a@b.com', subject: 'Re: update', headers: {} }), false);
});

/* ---- a tiny pretend database, so the whole run can be tested ---- */
function fakeDb(tables) {
  const T = tables; let id = 1000;
  const val = (row, c) => row[c];
  const cmp = (a, b) => (typeof a === 'string' && /^\d{4}-\d\d-\d\dT/.test(a) ? Date.parse(a) - Date.parse(b) : a < b ? -1 : a > b ? 1 : 0);
  function filter(rows, q) {
    for (const [k, raw] of q) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      const m = raw.match(/^(not\.)?(\w+)\.(.*)$/); const neg = !!m[1], op = m[2], v = m[3];
      rows = rows.filter(r => {
        const x = val(r, k); let ok;
        if (op === 'eq') ok = String(x) === v; else if (op === 'lt') ok = x != null && cmp(x, v) < 0; else if (op === 'lte') ok = x != null && cmp(x, v) <= 0;
        else if (op === 'like') ok = String(x).startsWith(v.replace(/\*$/, '')); else if (op === 'is') ok = (v === 'null' ? x == null : x != null);
        else if (op === 'in') ok = v.slice(1, -1).split(',').includes(String(x)); else throw new Error('op ' + op);
        return neg ? !ok : ok;
      });
    }
    return rows;
  }
  const parse = p => { const [t, qs = ''] = p.split('?'); return [t, [...new URLSearchParams(qs)]]; };
  const calls = [];
  return {
    T, calls,
    get: async p => { const [t, q] = parse(p); let rows = filter(T[t] || [], q); const lim = q.find(x => x[0] === 'limit'); if (lim) rows = rows.slice(0, +lim[1]); return rows.map(r => ({ ...r })); },
    post: async (p, body, prefer) => {
      const [t, q] = parse(p); const arr = [].concat(body); calls.push(['POST', t, body]); const made = [];
      for (const b of arr) {
        if (t === 'alerts' && T.alerts.some(a => a.shipment_id === b.shipment_id && a.kind === b.kind && a.text === b.text)) continue;
        const row = { id: 'n' + id++, created_at: new Date().toISOString(), ...b }; (T[t] = T[t] || []).push(row); made.push(row);
      }
      return prefer && prefer.includes('representation') ? made : null;
    },
    patch: async (p, body) => { const [t, q] = parse(p); calls.push(['PATCH', t, body]); filter(T[t], q).forEach(r => Object.assign(r, body)); },
    user: async id => ({ email: id === 'u1' ? 'owner@shop.com' : '' }),
  };
}
const NOW = Date.parse('2026-11-12T12:00:00Z'), ago = h => new Date(NOW - h * 3600e3).toISOString();
function world() {
  return {
    profiles: [{ id: 'u1', business_name: 'Rahim Imports', settings: { settings: { lang: 'English' } } }],
    transporters: [{ id: 't1', name: 'Ali Transport', email: 'ali@transport.com', language: 'Urdu' }, { id: 't2', name: 'No Email', email: '', language: 'English' }],
    shipments: [
      { id: 's1', owner: 'u1', ref: 'PO-1', transporter_id: 't1', status: 'pending', freq_hours: 12, archived: false, reply_token: 'aaaaaaaaaaaa1111', last_checkin: ago(30), last_reply: null, next_checkin: ago(-12), data: { mode: 'import', containerId: 'C1' } },
      { id: 's2', owner: 'u1', ref: 'PO-2', transporter_id: 't1', status: 'in_transit', freq_hours: 24, archived: false, reply_token: 'bbbbbbbbbbbb2222', last_checkin: ago(5), last_reply: ago(4), next_checkin: ago(1), data: { mode: 'import', containerId: 'C2' } },
      { id: 's3', owner: 'u1', ref: 'PO-3', transporter_id: 't2', status: 'pending', freq_hours: 24, archived: false, reply_token: 'cccccccccccc3333', last_checkin: null, last_reply: null, next_checkin: ago(2), data: {} },
      { id: 's4', owner: 'u1', ref: 'PO-4', transporter_id: 't1', status: 'delivered', freq_hours: 24, archived: false, reply_token: 'dddddddddddd4444', last_checkin: ago(50), last_reply: ago(49), next_checkin: ago(10), data: {} },
    ],
    messages: [], alerts: [], tickets: [{ id: 'k1', owner: 'u1', subject: 'Help', category: 'Billing', urgency: 'Low', body: 'Hello', notified: false }],
  };
}
test('a full run: replies, silence, due check-ins, support', async () => {
  const db = fakeDb(world()), mails = [], seen = [];
  const inbox = {
    unread: async () => [
      { uid: 1, from: 'ali@transport.com', to: ['gm+bbbbbbbbbbbb@gmail.com'], cc: [], subject: 'Re: Update request: PO-2 [MF-bbbbbbbbbbbb]', text: 'Delayed by bad weather, about a day late.\n\nOn Wed, 11 Nov 2026 at 10:00, Rahim Imports via Manifest wrote:\n> Hi', headers: {} },
      { uid: 2, from: 'random@x.com', to: ['gm@gmail.com'], cc: [], subject: 'hello there', text: 'spam', headers: {} },
      { uid: 3, from: 'ali@transport.com', to: ['gm+bbbbbbbbbbbb@gmail.com'], cc: [], subject: 'Out of office', text: 'away', headers: { 'auto-submitted': 'auto-replied' } },
    ],
    seen: async uid => seen.push(uid),
  };
  const stat = await main({ GMAIL_USER: 'gm@gmail.com', ADMIN_EMAIL: 'admin@x.com' }, { db, now: NOW, inbox, mailer: { send: async m => mails.push(m) }, log: () => {} });
  const T = db.T;
  // reply handled: status, warn, alert
  const s2 = T.shipments.find(s => s.id === 's2');
  assert.equal(s2.status, 'delayed'); assert.ok(s2.last_reply);
  assert.ok(T.messages.some(m => m.shipment_id === 's2' && m.kind === 'reply' && m.body === 'Reply: "Delayed by bad weather, about a day late."'));
  assert.ok(T.messages.some(m => m.shipment_id === 's2' && m.kind === 'warn' && /Delayed/.test(m.body)));
  assert.deepEqual(seen.sort(), [1, 2, 3]);
  // silence on s1 -> alert once
  assert.ok(mails.some(m => m.to === 'owner@shop.com' && /no reply about PO-1/.test(m.subject)));
  assert.ok(mails.some(m => m.to === 'owner@shop.com' && /PO-2 is delayed/.test(m.subject)));
  // due check-ins: s2 (was due) goes out in Urdu to Ali; s3 has no transporter email and is only pushed back; s4 delivered is skipped
  const out = mails.filter(m => m.to === 'ali@transport.com');
  assert.equal(out.length, 1, 'only one check-in'); assert.match(out[0].subject, /PO-2/);
  assert.equal(T.shipments.find(s => s.id === 's3').last_checkin, null);
  assert.ok(Date.parse(T.shipments.find(s => s.id === 's3').next_checkin) > NOW);
  assert.ok(T.messages.some(m => m.kind === 'sent' && /in Urdu/.test(m.body)));
  assert.equal(Date.parse(s2.next_checkin), NOW + 24 * 3600e3);
  // support message forwarded and marked
  assert.ok(mails.some(m => m.to === 'admin@x.com' && /Help/.test(m.subject)));
  assert.equal(T.tickets[0].notified, true);
  assert.equal(stat.errors, 0);
  // running again straight away does not repeat alerts or emails
  const before = mails.length;
  await main({ GMAIL_USER: 'gm@gmail.com', ADMIN_EMAIL: 'admin@x.com' }, { db, now: NOW + 60e3, inbox: { unread: async () => [], seen: async () => {} }, mailer: { send: async m => mails.push(m) }, log: () => {} });
  assert.equal(mails.length, before, 'nothing new to send');
});

test('a bounce warns the owner once', async () => {
  const db = fakeDb(world()), mails = [];
  const inbox = { unread: async () => [{ uid: 9, messageId: 'm1', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', to: ['gm@gmail.com'], cc: [], subject: 'Delivery Status Notification (Failure)', text: 'Subject: Update request: PO-2 [MF-bbbbbbbbbbbb]', headers: {} }], seen: async () => {} };
  await main({ GMAIL_USER: 'gm@gmail.com' }, { db, now: NOW, inbox, mailer: { send: async m => mails.push(m) }, log: () => {} });
  assert.ok(mails.some(m => /bounced/.test(m.subject)));
  assert.ok(db.T.messages.some(m => m.kind === 'warn' && /could not be delivered/.test(m.body)));
});

test('daily Gmail limit is respected', async () => {
  const w = world(); w.messages = Array.from({ length: 420 }, (_, i) => ({ id: 'x' + i, kind: 'sent', created_at: ago(1) }));
  const db = fakeDb(w), mails = [];
  await main({ GMAIL_USER: 'gm@gmail.com' }, { db, now: NOW, inbox: null, mailer: { send: async m => mails.push(m) }, log: () => {} });
  assert.equal(mails.filter(m => m.to === 'ali@transport.com').length, 0);
});
