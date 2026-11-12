// The real Gmail connections. Kept small, because they cannot be tested without a mailbox.
export async function makeMailer(user, pass) {
  const nodemailer = (await import('nodemailer')).default;
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  return { send: m => t.sendMail(m), close: () => t.close() };
}

export async function makeInbox(user, pass) {
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const c = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock('INBOX');
  return {
    async unread(days = 3, max = 60) {
      const uids = (await c.search({ seen: false, since: new Date(Date.now() - days * 864e5) })) || [];
      const out = [];
      for (const uid of uids.slice(0, max)) {
        const msg = await c.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const p = await simpleParser(msg.source);
        const addrs = v => (v ? [].concat(v).flatMap(x => x.value || []).map(a => a.address || '') : []);
        const headers = {}; if (p.headers) for (const [k, v] of p.headers) headers[k] = typeof v === 'string' ? v : (v && v.text) || '';
        out.push({
          uid, messageId: p.messageId || '', subject: p.subject || '',
          from: addrs(p.from).join(' '), to: addrs(p.to), cc: addrs(p.cc),
          text: p.text || (p.html ? String(p.html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ') : ''),
          headers,
        });
      }
      return out;
    },
    async seen(uid) { await c.messageFlagsAdd(uid, ['\\Seen'], { uid: true }); },
    async close() { lock.release(); await c.logout(); },
  };
}
