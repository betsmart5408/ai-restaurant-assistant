// Reimposta email e password dell'utente di un ristorante.
// Uso: node packages/api/scripts/reimposta-accesso.cjs <slug> <nuova-email> <nuova-password>
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const [slug, email, password] = process.argv.slice(2);
if (!slug || !email || !password) {
  console.error('Uso: node packages/api/scripts/reimposta-accesso.cjs <slug> <nuova-email> <nuova-password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('La password deve avere almeno 8 caratteri');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const pulita = email.toLowerCase().trim();
    const altri = await c.query(
      `SELECT 1 FROM users u JOIN restaurants r ON r.id = u.restaurant_id
       WHERE u.email = $1 AND r.slug <> $2`,
      [pulita, slug]
    );
    if (altri.rows.length) throw new Error('Questa email e\' gia\' usata da un altro ristorante');

    const utenti = await c.query(
      `SELECT u.id FROM users u JOIN restaurants r ON r.id = u.restaurant_id WHERE r.slug = $1`,
      [slug]
    );
    if (utenti.rows.length !== 1) {
      throw new Error(`Mi aspettavo 1 utente per "${slug}", ne ho trovati ${utenti.rows.length}`);
    }

    const hash = await bcrypt.hash(password, 10);
    // role 'owner': con 'superadmin' la dashboard apre il pannello admin
    // anche entrando come ristorante. Il super admin vero sta in `superadmins`.
    await c.query(
      `UPDATE users SET email = $1, password_hash = $2, role = 'owner' WHERE id = $3`,
      [pulita, hash, utenti.rows[0].id]
    );
    console.log(`Fatto. Accedi su https://app.lingofork.com con ${pulita}`);
  } finally {
    await c.end();
  }
})().catch(e => { console.error('Errore:', e.message); process.exit(1); });
