/**
 * Recupero dei ristoranti scartati per poco — complemento del passo 2.
 *
 *   node prospezione/recupera-mancanti.mjs
 *   node prospezione/recupera-mancanti.mjs --prova     (non salva, mostra solo)
 *
 * Perche' serve: leggi-siti cerca l'email SUL SITO del ristorante. Ma molti
 * locali l'email ce l'hanno gia' scritta in OpenStreetMap o in Foursquare, e
 * quella informazione era li' fin dall'inizio. Chi non la pubblica sul sito
 * (usa il modulo di contatto) veniva scartato lo stesso: un peccato, perche'
 * l'indirizzo lo avevamo.
 *
 * Questo script non visita nessun sito e non usa internet. Prende i risultati
 * di leggi-siti, ci rimette dentro le email che avevamo gia', e ricalcola chi
 * e' candidato con le stesse identiche regole di leggi-siti.
 *
 * Ogni email recuperata resta marcata nella colonna email_fonte, cosi' si sa
 * sempre da dove viene: 'sito' se l'ha trovata leggi-siti sulla pagina,
 * 'openstreetmap' o 'foursquare' se arriva dall'elenco di partenza.
 *
 * Non serve npm install: usa solo Node 18 o superiore.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const QUI = dirname(fileURLToPath(import.meta.url));
const CARTELLA_DATI = process.env.CARTELLA_DATI ? join(QUI, process.env.CARTELLA_DATI) : join(QUI, 'dati');

const argomenti = process.argv.slice(2);
const valore = (n) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const citta = (valore('--citta') || 'sydney').toLowerCase();
const prova = argomenti.includes('--prova');

// ── Le stesse reti di sicurezza di leggi-siti ───────────────────────────────
// Un'email presa dall'elenco vale solo se e' davvero un'email e non
// l'indirizzo di un fornitore di servizi o di una piattaforma.
const EMAIL_DA_SCARTARE = /@(sentry|wixpress|wix|squarespace|shopify|godaddy|weebly|webflow|duda|example|sentry\.io)\b|@(2x|3x)\b|\.(png|jpg|jpeg|gif|svg|webp)$/i;
const SEMBRA_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function emailBuona(e) {
  const v = String(e || '').trim().toLowerCase();
  if (!v) return '';
  if (!SEMBRA_EMAIL.test(v)) return '';
  if (EMAIL_DA_SCARTARE.test(v)) return '';
  return v;
}

// ── La regola del candidato: copiata parola per parola da leggi-siti ────────
function decidi(r) {
  const motivi = [];
  if (r.n_lingue > 1 || r.strumento_traduzione) motivi.push('ha gia\' piu\' lingue');
  if (!r.email) motivi.push('nessuna email trovata');
  if (!r.pagina_menu && !r.menu_pdf) motivi.push('nessun menu trovato sul sito');

  if (motivi.length === 0) {
    r.candidato = 'SI';
    r.motivo = 'Sito in una lingua sola, menu online, email disponibile.';
  } else if (motivi.includes('ha gia\' piu\' lingue')) {
    r.candidato = 'no';
    r.motivo = 'Gia\' multilingua: non ha il problema che risolviamo.';
  } else {
    r.candidato = 'forse';
    r.motivo = 'Manca qualcosa: ' + motivi.join(', ') + '.';
  }
  return r;
}

const COLONNE = ['candidato','nome','email','email_fonte','email_da_controllare','n_lingue','lingue','pagina_menu','punteggio_menu','menu_in_home','menu_dietro_ingresso','menu_pdf','cucina','indirizzo',
  'telefono','zona_etichetta','piattaforma','strumento_traduzione','stato','motivo','sito','tutte_le_email','osm_id','letto_il'];

function perCsv(v) { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }

function salva(righe) {
  const ordine = { 'SI': 0, 'forse': 1, 'no': 2, '': 3 };
  righe.sort((a,b) => (ordine[a.candidato] ?? 3) - (ordine[b.candidato] ?? 3) || String(a.nome).localeCompare(String(b.nome)));
  writeFileSync(join(CARTELLA_DATI, `siti-${citta}.json`), JSON.stringify(righe, null, 2), 'utf-8');
  const csv = [COLONNE.join(';'), ...righe.map(r => COLONNE.map(c => perCsv(r[c])).join(';'))].join('\r\n');
  writeFileSync(join(CARTELLA_DATI, `siti-${citta}.csv`), '﻿' + csv, 'utf-8');
}

function main() {
  const pSiti = join(CARTELLA_DATI, `siti-${citta}.json`);
  const pRist = join(CARTELLA_DATI, `ristoranti-${citta}.json`);
  if (!existsSync(pSiti)) { console.error(`Manca ${pSiti}. Lancia prima .\\leggi-siti.ps1`); process.exit(1); }
  if (!existsSync(pRist)) { console.error(`Manca ${pRist}. Lancia prima .\\trova-ristoranti.ps1`); process.exit(1); }

  const siti = JSON.parse(readFileSync(pSiti, 'utf-8'));
  const rist = JSON.parse(readFileSync(pRist, 'utf-8'));
  const perId = new Map(rist.map(r => [r.osm_id, r]));

  // Da dove veniva la scheda: l'identificativo Foursquare comincia per fsq/
  const fonteDi = (id) => String(id || '').startsWith('fsq/') ? 'foursquare' : 'openstreetmap';

  let recuperate = 0, promossi = 0, gia = 0, scartate = 0;
  const esempi = [];
  const primaCandidato = new Map(siti.map(r => [r.osm_id, r.candidato]));

  for (const r of siti) {
    if (r.email) { if (!r.email_fonte) r.email_fonte = 'sito'; gia++; continue; }
    const sorgente = perId.get(r.osm_id);
    if (!sorgente) continue;
    const e = emailBuona(sorgente.email);
    if (!e) { if (sorgente.email) scartate++; continue; }
    r.email = e;
    r.email_fonte = fonteDi(r.osm_id);
    recuperate++;
    if (esempi.length < 10) esempi.push(`${r.nome} -> ${e} (${r.email_fonte})`);
  }

  // Ricalcolo solo per i siti che siamo riusciti a leggere: se il sito non
  // rispondeva, l'email da sola non fa un candidato.
  for (const r of siti) {
    if (r.stato !== 'ok') continue;
    decidi(r);
    if (primaCandidato.get(r.osm_id) !== 'SI' && r.candidato === 'SI') promossi++;
  }

  const conta = (v) => siti.filter(r => r.candidato === v).length;
  console.log('');
  console.log(`Schede lette in tutto: ${siti.length}`);
  console.log(`Email che avevamo gia' trovato sul sito: ${gia}`);
  console.log(`Email recuperate dall'elenco di partenza: ${recuperate}`);
  if (scartate) console.log(`Email dell'elenco buttate perche' non valide: ${scartate}`);
  console.log('');
  console.log(`Nuovi candidati pieni: ${promossi}`);
  console.log(`Totale ora -> SI: ${conta('SI')}   forse: ${conta('forse')}   no: ${conta('no')}`);
  if (esempi.length) { console.log('\nEsempi di email recuperate:'); esempi.forEach(e => console.log('  ' + e)); }

  if (prova) { console.log('\n(--prova: non ho salvato niente)'); return; }

  copyFileSync(pSiti, join(CARTELLA_DATI, `siti-${citta}-prima-del-recupero.json`));
  salva(siti);
  console.log(`\nSalvato in siti-${citta}.json e siti-${citta}.csv`);
  console.log(`La versione di prima e' al sicuro in siti-${citta}-prima-del-recupero.json`);
}

main();
