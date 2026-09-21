// Riporta allo stato di demo un ristorante attivato per prova: toglie
// l'utente che l'ha attivato, rimette is_demo e crea un nuovo link di
// attivazione. Menu, traduzioni e demo_email (l'email vera del locale)
// restano come sono.
// Uso: node packages/api/scripts/ripristina-demo.cjs <slug> [<slug> ...]
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const slugs = process.argv.slice(2);
const DASHBOARD = (process.env.DASHBOARD_URL || 'https://app.lingofork.com').replace(/\/+$/, '');
if (!slugs.length) {
  console.error('Uso: node packages/api/scripts/ripristina-demo.cjs <slug> [<slug> ...]');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    for (const slug of slugs) {
      await c.query('BEGIN');
      const r = await c.query(
        `SELECT id, name, is_demo, stripe_subscription_id FROM restaurants WHERE slug = $1 FOR UPDATE`,
        [slug]
      );
      const rest = r.rows[0];
      if (!rest) { await c.query('ROLLBACK'); console.log(`- ${slug}: non esiste, salto`); continue; }
      if (rest.is_demo) { await c.query('ROLLBACK'); console.log(`- ${rest.name}: e' gia' una demo, salto`); continue; }
      // Mai toccare chi paga davvero
      if (rest.stripe_subscription_id) {
        await c.query('ROLLBACK');
        console.log(`- ${rest.name}: ha un abbonamento Stripe, NON lo tocco`);
        continue;
      }

      const utenti = await c.query('DELETE FROM users WHERE restaurant_id = $1 RETURNING email', [rest.id]);
      const token = crypto.randomBytes(18).toString('base64url');
      await c.query(
        `UPDATE restaurants SET
           is_demo = TRUE, demo_claim_token = $2, billing_email = NULL,
           plan = 'trial', subscription_status = 'trialing', suspended_at = NULL
         WHERE id = $1`,
        [rest.id, token]
      );
      await c.query('COMMIT');
      console.log(`- ${rest.name}: di nuovo demo (tolto l'accesso di ${utenti.rows.map(u => u.email).join(', ') || 'nessuno'})`);
      console.log(`    nuovo link: ${DASHBOARD}/attiva?attiva=${encodeURIComponent(slug)}&token=${token}`);
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch(e => { console.error('Errore:', e.message); process.exit(1); });
