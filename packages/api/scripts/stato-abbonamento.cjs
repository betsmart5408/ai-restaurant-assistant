// Cambia a mano lo stato dell'abbonamento di un ristorante.
// Uso: node packages/api/scripts/stato-abbonamento.cjs <slug> <trialing|active|cancelled>
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const [slug, stato] = process.argv.slice(2);
const PIANO = { trialing: 'trial', active: 'pro', cancelled: 'trial' };
if (!slug || !PIANO[stato]) {
  console.error('Uso: node packages/api/scripts/stato-abbonamento.cjs <slug> <trialing|active|cancelled>');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(
      `UPDATE restaurants SET subscription_status = $2, plan = $3, suspended_at = NULL,
         trial_ends_at = CASE WHEN $2 = 'trialing' THEN NOW() + INTERVAL '7 days' ELSE trial_ends_at END
       WHERE slug = $1 AND is_demo IS NOT TRUE RETURNING name`,
      [slug, stato, PIANO[stato]]
    );
    if (!r.rows.length) throw new Error(`Nessun ristorante (non demo) con slug "${slug}"`);
    console.log(`Fatto: ${r.rows[0].name} ora e' "${stato}"`);
  } finally {
    await c.end();
  }
})().catch(e => { console.error('Errore:', e.message); process.exit(1); });
