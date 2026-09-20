/**
 * Quanto rendono davvero le risposte dirette.
 *
 *   npm run intenti --workspace=packages/api
 *   npm run intenti --workspace=packages/api -- --giorni 30
 *   npm run intenti --workspace=packages/api -- --lingue
 *
 * Legge la tabella chat_intenti (migrazione 018) e dice quante domande dei
 * clienti ha risolto il database e quante hanno avuto bisogno del modello.
 *
 * Il numero che conta e' l'ultimo: "risolte senza modello". La stima fatta a
 * tavolino diceva il 60%. Qui c'e' quello vero, e da quello si decide se e
 * quando vale la pena spostare la chat su una macchina propria.
 */
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env.');
  process.exit(1);
}

const argomenti = process.argv.slice(2);
function valore(nome: string): string | undefined {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : undefined;
}
const giorni = Number(valore('--giorni')) || 14;
const perLingua = argomenti.includes('--lingue');

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const ETICHETTE: Record<string, string> = {
  piatto: 'Scheda di un piatto',
  allergeni: 'Domanda sugli allergeni',
  ordine: '"Voglio ordinare"',
  saluto: 'Ringraziamenti',
  modello: 'Passate al modello',
};

// Token risparmiati da una risposta diretta: e' un messaggio che NON ha
// rispedito il prompt (2.187 token dopo il menu compatto) piu' lo storico.
const TOKEN_RISPARMIATI_PER_RISPOSTA = 2187 + 600 + 400;

function barra(quota: number, larghezza = 28): string {
  const pieni = Math.round(quota * larghezza);
  return '█'.repeat(pieni) + '░'.repeat(larghezza - pieni);
}

async function main() {
  const esiste = await db.query(
    `SELECT to_regclass('public.chat_intenti') IS NOT NULL AS c`,
  );
  if (!esiste.rows[0]?.c) {
    console.error('La tabella chat_intenti non esiste ancora.');
    console.error('Applica le migrazioni:  .\\aggiorna-database.ps1');
    process.exit(1);
  }

  const r = await db.query<{ intento: string; quanti: string }>(
    `SELECT intento, SUM(quanti)::bigint AS quanti
       FROM chat_intenti
      WHERE giorno > CURRENT_DATE - $1::int
      GROUP BY intento
      ORDER BY SUM(quanti) DESC`,
    [giorni],
  );

  const totale = r.rows.reduce((s, x) => s + Number(x.quanti), 0);
  if (totale === 0) {
    console.log(`\nNessun messaggio negli ultimi ${giorni} giorni.`);
    console.log('Il contatore parte dal primo messaggio dopo il deploy.\n');
    await db.end();
    return;
  }

  console.log(`\nRISPOSTE AI CLIENTI — ultimi ${giorni} giorni\n`);
  console.log(`${'INTENTO'.padEnd(26)} ${'QUANTE'.padStart(8)} ${'QUOTA'.padStart(7)}`);
  console.log('─'.repeat(74));
  for (const riga of r.rows) {
    const n = Number(riga.quanti);
    const quota = n / totale;
    const nome = ETICHETTE[riga.intento] ?? riga.intento;
    console.log(`${nome.padEnd(26)} ${String(n).padStart(8)} ${(quota * 100).toFixed(1).padStart(6)}%  ${barra(quota)}`);
  }
  console.log('─'.repeat(74));

  const modello = Number(r.rows.find(x => x.intento === 'modello')?.quanti ?? 0);
  const inCasa = totale - modello;
  const quotaCasa = inCasa / totale;

  console.log(`${'TOTALE'.padEnd(26)} ${String(totale).padStart(8)}`);
  console.log(`\nRisolte senza modello: ${inCasa} su ${totale}  =  ${(quotaCasa * 100).toFixed(1)}%`);
  console.log(`(la stima fatta a tavolino diceva 60%)`);

  const risparmiati = inCasa * TOKEN_RISPARMIATI_PER_RISPOSTA;
  console.log(`\nToken NON spediti al modello: ${(risparmiati / 1e6).toFixed(1)}M in ${giorni} giorni`);
  console.log(`Alle tariffe Groq a pagamento sono circa $${(risparmiati * 0.15 / 1e6).toFixed(2)} risparmiati.`);

  if (perLingua) {
    const l = await db.query<{ lingua: string; casa: string; modello: string }>(
      `SELECT lingua,
              COALESCE(SUM(quanti) FILTER (WHERE intento <> 'modello'), 0) AS casa,
              COALESCE(SUM(quanti) FILTER (WHERE intento =  'modello'), 0) AS modello
         FROM chat_intenti
        WHERE giorno > CURRENT_DATE - $1::int
        GROUP BY lingua
        ORDER BY SUM(quanti) DESC`,
      [giorni],
    );
    console.log(`\nPER LINGUA — dove le risposte dirette funzionano e dove no\n`);
    console.log(`${'LINGUA'.padEnd(8)} ${'IN CASA'.padStart(8)} ${'MODELLO'.padStart(8)} ${'QUOTA'.padStart(7)}`);
    console.log('─'.repeat(40));
    for (const x of l.rows) {
      const casa = Number(x.casa ?? 0), mod = Number(x.modello ?? 0);
      const tot = casa + mod;
      if (tot === 0) continue;
      console.log(`${(x.lingua || '?').padEnd(8)} ${String(casa).padStart(8)} ${String(mod).padStart(8)} ${(casa / tot * 100).toFixed(1).padStart(6)}%`);
    }
  }

  console.log('');
  await db.end();
}

main().catch(async err => {
  console.error('Errore:', err instanceof Error ? err.message : err);
  await db.end().catch(() => {});
  process.exit(1);
});
