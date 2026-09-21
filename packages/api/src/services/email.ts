// Invio email tramite Resend (https://resend.com), con una semplice chiamata
// HTTP: niente SDK. Senza RESEND_API_KEY non parte niente e lo si dice nei log.
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'LingoFork <noreply@lingofork.com>';
// Le risposte dei ristoratori non devono finire nel vuoto di noreply@
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'info@lingofork.com';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function mandaEmail(email: Email): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY mancante: non mando "${email.subject}" a ${email.to}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, reply_to: EMAIL_REPLY_TO, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
    });
    if (!res.ok) {
      console.error(`[email] Resend ha risposto ${res.status}:`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] invio non riuscito:', err);
    return false;
  }
}

export function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Scheletro comune delle email: una colonna, un pulsante, testo di riserva.
export function emailConPulsante(opts: { titolo: string; paragrafi: string[]; pulsante: string; link: string; nota?: string }): string {
  const p = opts.paragrafi.map(t => `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.55">${t}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;padding:32px 28px">
<tr><td>
<div style="font-weight:800;font-size:18px;color:#6366f1;margin-bottom:22px">LingoFork</div>
<h1 style="margin:0 0 16px;font-size:21px;color:#0f172a">${opts.titolo}</h1>
${p}
<a href="${opts.link}" style="display:inline-block;margin:8px 0 18px;background:#6366f1;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${opts.pulsante}</a>
<p style="margin:0 0 6px;color:#64748b;font-size:12px">Se il pulsante non funziona, copia questo indirizzo nel browser:</p>
<p style="margin:0 0 18px;color:#6366f1;font-size:12px;word-break:break-all">${opts.link}</p>
${opts.nota ? `<p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5">${opts.nota}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}
