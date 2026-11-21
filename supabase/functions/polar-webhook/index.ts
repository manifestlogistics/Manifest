// Manifest payments: one Supabase Edge Function that talks to Polar.
//   POST /polar-webhook            Polar tells us a subscription started, renewed, was cancelled or ended.
//   POST /polar-webhook/checkout   A signed-in customer asks for a payment page for Growth or Pro.
//   POST /polar-webhook/portal     A signed-in customer asks for the "manage my subscription" page.
// Switch "Verify JWT" OFF for this function. Customers are checked inside the code, and Polar sends no login.
//
// Secrets to add under Edge Functions -> Secrets (names exactly as written):
//   POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_GROWTH_PRODUCT_ID, POLAR_PRO_PRODUCT_ID
//   Optional: POLAR_SERVER (sandbox or production, default production), SITE_URL, SB_SECRET_KEY (only if the built-in key is missing)

const enc = new TextEncoder();
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u8) => btoa(String.fromCharCode(...u8));
const sameStr = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function verifySignature(secret, id, ts, sigHeader, body, nowMs = Date.now()) {
  if (!secret || !id || !ts || !sigHeader) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > 600) return false;
  const keys = [enc.encode(secret)];                       // Polar's older style: the whole secret text is the key
  try { keys.push(b64d(secret.replace(/^whsec_/, ''))); } catch (_e) { /* not base64 */ }   // Standard Webhooks style
  const data = enc.encode(`${id}.${ts}.${body}`);
  for (const k of keys) {
    const ck = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = b64e(new Uint8Array(await crypto.subtle.sign('HMAC', ck, data)));
    for (const part of String(sigHeader).split(' ')) {
      const [v, sig] = part.split(',');
      if (v === 'v1' && sig && sameStr(sig, want)) return true;
    }
  }
  return false;
}

// Works out what a Polar subscription means for the customer's plan.
export function entitlement(sub, type, productPlans, nowMs = Date.now()) {
  const plan = productPlans[sub.product_id || (sub.product && sub.product.id)];
  if (!plan) return null;
  const end = sub.current_period_end ? Date.parse(sub.current_period_end) : null;
  const status = sub.status;
  let on;
  if (type === 'subscription.revoked' || ['incomplete', 'incomplete_expired', 'unpaid', 'revoked'].includes(status)) on = false;
  else if (['active', 'trialing', 'past_due'].includes(status)) on = true;
  else if (status === 'canceled') on = !!(sub.cancel_at_period_end && end && end > nowMs);   // cancelled: keeps the plan until the period ends
  else on = false;
  return { on, plan, end, cancel: !!sub.cancel_at_period_end, status };
}

export function makeHandler(env, fetchImpl = fetch) {
  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SB_SECRET_KEY || '';
  const API = (env.POLAR_SERVER || 'production') === 'sandbox' ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1';
  const SITE = (env.SITE_URL || 'https://manifestlogistics.app').replace(/\/$/, '');
  const PRODUCTS = { growth: env.POLAR_GROWTH_PRODUCT_ID, pro: env.POLAR_PRO_PRODUCT_ID };
  const productPlans = {}; for (const [plan, id] of Object.entries(PRODUCTS)) if (id) productPlans[id] = plan;
  const legacy = KEY.startsWith('eyJ');
  const dbh = (x) => ({ apikey: KEY, ...(legacy ? { Authorization: 'Bearer ' + KEY } : {}), 'Content-Type': 'application/json', ...x });
  const db = async (path, o = {}) => {
    const r = await fetchImpl(`${SB}/rest/v1/${path}`, { method: o.method || 'GET', headers: dbh(o.headers), body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    if (!r.ok) { const t = await r.text(); const e = new Error(`db ${r.status}: ${t.slice(0, 200)}`); e.status = r.status; e.text = t; throw e; }
    const t = await r.text(); return t ? JSON.parse(t) : null;
  };
  const cors = (req) => {
    const o = req.headers.get('origin') || '';
    const ok = o === SITE || o === SITE.replace('://', '://www.') ;
    return { 'Access-Control-Allow-Origin': ok ? o : SITE, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  };
  const json = (req, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });
  const polar = (path, body) => fetchImpl(API + path, { method: 'POST', headers: { Authorization: 'Bearer ' + env.POLAR_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function user(req) {
    const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!tok) return null;
    const r = await fetchImpl(`${SB}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY || KEY, Authorization: 'Bearer ' + tok } });
    if (!r.ok) return null;
    const u = await r.json(); return u && u.id ? { id: u.id, email: u.email || '' } : null;
  }

  async function checkout(req) {
    if (!env.POLAR_ACCESS_TOKEN) return json(req, { error: 'Payments are not switched on yet. Please try again soon.' }, 404);
    const u = await user(req); if (!u) return json(req, { error: 'Please log in again.' }, 401);
    let b = {}; try { b = await req.json(); } catch (_e) { /* empty */ }
    const productId = PRODUCTS[b.plan];
    if (!productId) return json(req, { error: 'Unknown plan.' }, 400);
    const mine = await db(`billing?select=polar_customer_id,polar_status,paid&owner=eq.${u.id}`).catch(() => []);
    if (mine && mine[0] && mine[0].paid && mine[0].polar_customer_id) return json(req, { error: 'You already have a subscription. Use Manage subscription to change plan.' }, 409);
    const ip = (req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim();
    const r = await polar('/checkouts/', {
      products: [productId], external_customer_id: u.id, customer_email: u.email, metadata: { user_id: u.id, plan: b.plan },
      success_url: `${SITE}/app/?checkout_id={CHECKOUT_ID}`, return_url: `${SITE}/app/`, ...(ip ? { customer_ip_address: ip } : {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { console.error('polar checkout failed', r.status, JSON.stringify(j).slice(0, 300)); return json(req, { error: 'We could not open the payment page. Please try again in a minute.' }, 502); }
    return json(req, { url: j.url });
  }

  async function portal(req) {
    if (!env.POLAR_ACCESS_TOKEN) return json(req, { error: 'Payments are not switched on yet. Please try again soon.' }, 404);
    const u = await user(req); if (!u) return json(req, { error: 'Please log in again.' }, 401);
    const mine = await db(`billing?select=polar_customer_id&owner=eq.${u.id}`).catch(() => []);
    const cid = mine && mine[0] && mine[0].polar_customer_id;
    if (!cid) return json(req, { error: 'You do not have a subscription yet.' }, 404);
    const r = await polar('/customer-sessions/', { customer_id: cid, return_url: `${SITE}/app/` });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.customer_portal_url) { console.error('polar portal failed', r.status, JSON.stringify(j).slice(0, 300)); return json(req, { error: 'We could not open your subscription page. Please try again in a minute.' }, 502); }
    return json(req, { url: j.customer_portal_url });
  }

  async function webhook(req) {
    const body = await req.text();
    const ok = await verifySignature(env.POLAR_WEBHOOK_SECRET || '', req.headers.get('webhook-id'), req.headers.get('webhook-timestamp'), req.headers.get('webhook-signature'), body);
    if (!ok) return new Response('bad signature', { status: 403 });
    let ev; try { ev = JSON.parse(body); } catch (_e) { return new Response('bad json', { status: 400 }); }
    const id = req.headers.get('webhook-id');
    try { await db('polar_events', { method: 'POST', body: { id, type: ev.type || '' }, headers: { Prefer: 'return=minimal' } }); }
    catch (e) { if (e.status === 409 || /duplicate|23505/.test(e.text || '')) return new Response('already handled', { status: 202 }); console.error('event log failed', e.message); }
    const type = String(ev.type || '');
    if (!type.startsWith('subscription.')) return new Response('ignored', { status: 202 });
    const sub = ev.data || {};
    const uid = (sub.customer && sub.customer.external_id) || (sub.metadata && sub.metadata.user_id) || (sub.checkout && sub.checkout.metadata && sub.checkout.metadata.user_id);
    const ent = entitlement(sub, type, productPlans);
    if (!uid || !ent) { console.error('subscription event ignored', type, !!uid, !!ent); return new Response('ignored', { status: 202 }); }
    const row = {
      owner: uid, polar_customer_id: sub.customer_id || (sub.customer && sub.customer.id) || null, polar_subscription_id: sub.id || null,
      polar_status: ent.status || null, period_end: sub.current_period_end || null, cancel_at_period_end: ent.cancel, updated_at: new Date().toISOString(),
      pay_country: (sub.customer && sub.customer.billing_address && sub.customer.billing_address.country) || null,
      ...(ent.on ? { plan: ent.plan, paid: true, trial_ends: null } : { plan: 'starter', paid: false }),
    };
    if (!row.pay_country) delete row.pay_country;
    try { await db('billing?on_conflict=owner', { method: 'POST', body: row, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }); }
    catch (e) { console.error('billing update failed', e.message); return new Response('retry', { status: 500 }); }   // Polar retries on a non-2xx answer
    return new Response('ok', { status: 202 });
  }

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try {
      if (path.endsWith('/checkout')) return await checkout(req);
      if (path.endsWith('/portal')) return await portal(req);
      return await webhook(req);
    } catch (e) { console.error('polar function error', e && e.message); return json(req, { error: 'Something went wrong. Please try again.' }, 500); }
  };
}

// @ts-ignore Deno exists when this runs on Supabase
const D = globalThis.Deno;
if (D && D.serve) D.serve(makeHandler(D.env.toObject()));
