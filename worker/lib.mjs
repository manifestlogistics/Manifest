// Pure helpers for the Manifest worker: no network, so they are easy to test.
import { TR, LCODE, RTL } from './i18n.mjs';

export const HR = 3600e3;
export const LABELS = { pending: 'Waiting for reply', in_transit: 'On the way', customs_hold: 'Held at customs', delayed: 'Delayed', delivered: 'Delivered', cancelled: 'Cancelled' };
export const BUTTONS = [['moving', 'On the way'], ['customs', 'Held at customs'], ['delayed', 'Delayed'], ['delivered', 'Delivered']];

export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clean = v => String(v == null ? '' : v).replace(/[\r\n"<>]+/g, ' ').replace(/\s+/g, ' ').trim();
export const validEmail = e => /^[^\s@,;<>]+@[^\s@,;<>]+\.[A-Za-z]{2,}$/.test(String(e || '').trim());

export function fill(t, v) {
  return String(t).replace(/\{\{(\w+)\}\}/g, (m, k) => (v[k] != null ? v[k] : m)).replace(/\s*[(（]\s*[)）]/g, '');
}

/** The message a transporter reads: the business's own wording, or our translation. */
export function messageFor(lang, tpl, vars) {
  const def = TR.en;
  const custom = tpl && String(tpl).trim() && String(tpl).trim() !== def;
  const base = custom ? tpl : (TR[LCODE[lang]] || TR.en);
  return fill(base, vars);
}
export const isRtl = lang => RTL.includes(LCODE[lang]);

export const replyTag = token => String(token).slice(0, 12);
export function replyTo(gmail, token) { const [l, d] = String(gmail).split('@'); return `${l}+${replyTag(token)}@${d}`; }

export function identOf(data) { return data && data.mode === 'local' ? (data.vehicle || '') : ((data && data.containerId) || ''); }

/** Build the check-in email for one shipment. */
export function buildCheckin({ site, gmail, ship, transporter, profile }) {
  const data = ship.data || {};
  const st = (profile && profile.settings && profile.settings.settings) || {};
  const lang = transporter.language || st.lang || 'English';
  const body = messageFor(lang, st.tpl, { transporter_name: transporter.name || '', shipment_id: ship.ref, container_id: identOf(data) });
  const business = clean((profile && profile.business_name) || 'Manifest');
  const links = BUTTONS.map(([k, l]) => ({ l, u: `${site}/r/?t=${ship.reply_token}&s=${k}` }));
  const tag = replyTag(ship.reply_token);
  const rtl = isRtl(lang);
  const text = `${body}\n\n${links.map(x => `${x.l}: ${x.u}`).join('\n')}\n\nOr simply reply to this email.\n\nSent by Manifest for ${business}.`;
  const html = `<div dir="${rtl ? 'rtl' : 'ltr'}" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0F172A;max-width:520px"><p>${esc(body)}</p><p style="margin:20px 0 8px">${links.map(x => `<a href="${esc(x.u)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 16px;background:#2563EB;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px">${esc(x.l)}</a>`).join('')}</p><p style="color:#475569;font-size:14px">Or simply reply to this email.</p><p style="color:#94A3B8;font-size:12px;margin-top:24px">Sent by Manifest for ${esc(business)}.</p></div>`;
  return {
    lang,
    from: { name: `${business} via Manifest`.slice(0, 70), address: gmail },
    to: transporter.email.trim(),
    replyTo: replyTo(gmail, ship.reply_token),
    subject: `Update request: ${clean(ship.ref)} [MF-${tag}]`,
    text, html,
  };
}

/** Pull the shipment tag out of a reply or a bounce. */
export function tagFrom({ to = [], cc = [], subject = '', text = '' }) {
  const hay = [...to, ...cc].join(' ');
  let m = hay.match(/\+([a-f0-9]{12})@/i); if (m) return m[1].toLowerCase();
  m = String(subject).match(/\[MF-([a-f0-9]{12})\]/i); if (m) return m[1].toLowerCase();
  m = String(text).match(/\[MF-([a-f0-9]{12})\]/i); if (m) return m[1].toLowerCase();
  m = String(text).match(/\+([a-f0-9]{12})@/i); if (m) return m[1].toLowerCase();
  return '';
}

/** Keep only what the person actually wrote, without the quoted email below it. */
export function cleanReply(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n'); const out = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (/^>/.test(t)) break;
    if (/^On .{5,200}wrote:?$/i.test(t) || /^On .{5,120}$/i.test(t) && out.length && /wrote:?$/i.test(lines[lines.indexOf(ln) + 1] || '')) break;
    if (/^-{2,}\s*(original message|forwarded message)/i.test(t) || /^_{5,}$/.test(t)) break;
    if (/^(from|sent|to|subject):\s/i.test(t) && out.length) break;
    if (/^(sent from my|get outlook for)/i.test(t)) break;
    if (/^(on the way|held at customs|delayed|delivered):\s*https?:\/\//i.test(t)) break;
    if (/^or simply reply to this email/i.test(t)) break;
    out.push(ln);
  }
  let s = out.join(' ').replace(/\s+/g, ' ').trim();
  if (s.length > 500) s = s.slice(0, 497).trimEnd() + '…';
  return s;
}

/** Turn a free-text reply into a status. Simple rules, on purpose. */
export function classify(text) {
  const t = String(text || '').toLowerCase();
  const notDone = /\b(not|n't|yet to|will be|to be|going to be|before|until|once|when|if)\b[^.!?]{0,25}\bdelivered\b/.test(t) || /\bnot yet\b.{0,12}\b(arrived|delivered)\b/.test(t);
  if (!notDone && /\b(delivered|delivery (is )?(done|complete[d]?)|handed over|signed by|received by (the )?(consignee|customer|warehouse|store)|unloaded)\b/.test(t)) return 'delivered';
  const cleared = /\b(cleared (the )?customs|customs (is |has )?cleared|clearance (is )?(done|complete[d]?)|released from customs)\b/.test(t);
  if (!cleared && /\b(customs?|clearance|examination|inspection|held at (the )?port|quarantine)\b/.test(t)) return 'customs_hold';
  if (/\b(delay(ed|s)?|late|behind schedule|break ?down|broke down|stuck|stranded|accident|puncture|strike|bad weather|storm|rerouted|postponed|not moving|not (yet )?(arrived|loaded)|will (be )?(arrive )?(a )?(day|days|week) late|days? late|cancel(l)?ed)\b/.test(t)) return 'delayed';
  return 'in_transit';
}

export function isAuto({ from = '', subject = '', headers = {} }) {
  const f = String(from).toLowerCase(), s = String(subject).toLowerCase();
  const as = String(headers['auto-submitted'] || '').toLowerCase();
  return /mailer-daemon|postmaster/.test(f) || (as && as !== 'no') || /^(auto(matic)? reply|out of office|automatic reply)/.test(s);
}
export const isBounce = ({ from = '', subject = '' }) => /mailer-daemon|postmaster/i.test(from) || /undeliver|delivery status notification|returned mail|failure notice/i.test(subject);

/** How long we wait for a reply before we tell the owner it has gone quiet. */
export function silenceHours(freqHours) { return Math.max(24, Math.min(48, Number(freqHours) || 24)); }
export function isSilent(s, now) {
  if (!s.last_checkin) return false;
  const asked = new Date(s.last_checkin).getTime();
  if (s.last_reply && new Date(s.last_reply).getTime() >= asked) return false;
  return now - asked >= silenceHours(s.freq_hours) * HR;
}
export const nextCheckin = (now, freqHours) => new Date(now + (Number(freqHours) || 168) * HR).toISOString();
export function agoText(ms) { const h = Math.round(ms / HR); return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`; }
