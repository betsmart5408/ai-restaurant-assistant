/**
 * Genera i link "Attiva la tua demo" da mandare ai ristoratori.
 *
 *   node prospezione/link-attiva.mjs                    tutte le demo
 *   node prospezione/link-attiva.mjs --slug al-aseel    una sola
 *   node prospezione/link-attiva.mjs --rifai            rigenera anche i token già fatti
 *   node prospezione/link-attiva.mjs --url https://tua-dashboard.vercel.app
 *
 * Ogni link porta a /attiva?attiva=<slug>&token=<token>: il ristoratore
 * sceglie email e password, la demo diventa il suo account (parte il trial).
 * Il token vale una volta: dopo l'attivazione si azzera.
 *
 * Scrive anche prospezione/dati/link-attiva.csv (nome,email,link) per il
 * mail-merge.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import pg from 'pg';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, '..');

const argomenti = process.argv.slice(2);
const valore = (n) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const soloSlug = valore('--slug');
const rifai = argomenti.includes('--rifai');
const DASHBOARD = (valore('--url') || 'https://restaurant-dashboard-two-hazel.vercel.app').replace(/\/+$/, '');

function daEnv(nome) {
  if (process.env[nome]) return process.env[nome];
  const env = join(RADICE, '.env');
  if (!existsSync(env)) return '';
  for (const riga of readFileSync(env, 'utf-8').split('\n')) {
    const t = riga.trim();
    if (t.startsWith(nome + '=')) return t.slice(nome.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

async function main() {
  const url = daEnv('DATABASE_URL');
  if (!url) { console.error('Manca DATABASE_URL nel .env'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: url });

  const colonne = new Set((await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'restaurants'`
  )).rows.map(r => r.column_name));
  if (!colonne.has('demo_claim_token')) {
    console.error('Manca la colonna demo_claim_token: lancia prima .\\aggiorna-database.ps1 (migrazione 015).');
    await pool.end(); process.exit(1);
  }
  const haEmail = colonne.has('demo_email');

  let sql = `SELECT id, slug, name, demo_claim_token${haEmail ? ', demo_email' : ", '' AS demo_email"}
             FROM restaurants WHERE is_demo = TRUE`;
  const params = [];
  if (soloSlug) { params.push(soloSlug); sql += ` AND slug = $${params.length}`; }
  sql += ' ORDER BY name';

  const demo = (await pool.query(sql, params)).rows;
  if (demo.length === 0) { console.log('Nessuna demo (is_demo = TRUE) trovata.'); await pool.end(); return; }

  const righe = [];
  let nuoviToken = 0;
  for (const r of demo) {
    let token = r.demo_claim_token;
    if (!token || rifai) {
      token = randomBytes(18).toString('base64url');
      await pool.query('UPDATE restaurants SET demo_claim_token = $1 WHERE id = $2', [token, r.id]);
      nuoviToken++;
    }
    const link = `${DASHBOARD}/attiva?attiva=${encodeURIComponent(r.slug)}&token=${token}`;
    righe.push({ nome: r.name, email: r.demo_email || '', link });
  }

  console.log(`\n${demo.length} demo — ${nuoviToken} token nuovi.\n`);
  righe.forEach(x => {
    console.log(`  ${x.nome}`);
    console.log(`    ${x.link}`);
    if (x.email) console.log(`    (email: ${x.email})`);
  });

  const cartella = join(QUI, 'dati');
  if (!existsSync(cartella)) mkdirSync(cartella, { recursive: true });
  const csv = 'nome,email,link\n' + righe.map(x =>
    `"${x.nome.replace(/"/g, '""')}","${x.email}","${x.link}"`).join('\n') + '\n';
  writeFileSync(join(cartella, 'link-attiva.csv'), csv, 'utf-8');
  console.log(`\nCSV per il mail-merge: prospezione/dati/link-attiva.csv`);

  await pool.end();
}

main().catch(e => { console.error('Errore:', e.message); process.exit(1); });
