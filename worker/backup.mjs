// Weekly backup: every table is saved to a file and emailed to you. The file never sits in GitHub.
import { gzipSync } from 'node:zlib';
import { makeDb } from './run.mjs';
import { makeMailer } from './mail.mjs';

const env = process.env;
const need = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'].filter(k => !env[k]);
if (need.length) { console.error('Missing settings: ' + need.join(', ')); process.exit(1); }
const db = makeDb(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const out = { taken_at: new Date().toISOString() };
for (const t of ['profiles', 'transporters', 'shipments', 'messages', 'alerts', 'tickets']) {
  let all = [], from = 0;
  for (;;) { const rows = (await db.get(`${t}?select=*&order=created_at.asc&limit=1000&offset=${from}`)) || []; all = all.concat(rows); if (rows.length < 1000) break; from += 1000; }
  out[t] = all; console.log(t, all.length);
}
const gz = gzipSync(JSON.stringify(out));
const mailer = await makeMailer(env.GMAIL_USER, env.GMAIL_APP_PASSWORD);
const day = new Date().toISOString().slice(0, 10);
await mailer.send({ from: { name: 'Manifest backup', address: env.GMAIL_USER }, to: env.ADMIN_EMAIL || env.GMAIL_USER, subject: `Manifest weekly backup ${day}`, text: 'Your weekly Manifest backup is attached. Keep it somewhere safe. It contains your customers\' data, so do not share it.', attachments: [{ filename: `manifest-backup-${day}.json.gz`, content: gz }] });
mailer.close();
console.log('backup emailed,', Math.round(gz.length / 1024), 'KB');
