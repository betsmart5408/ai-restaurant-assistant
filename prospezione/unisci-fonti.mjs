/**
 * Unisce OpenStreetMap e Foursquare in un elenco solo.
 *
 *   node prospezione/unisci-fonti.mjs
 *   node prospezione/unisci-fonti.mjs --ovunque    (anche fuori dalle zone turistiche)
 *
 * Regole dell'unione:
 *  - due schede sono lo STESSO locale se puntano allo stesso dominio;
 *  - quando coincidono si tiene l'identificativo di OpenStreetMap, cosi'
 *    leggi-siti riconosce i 609 siti gia' letti e non li rilegge;
 *  - i campi si sommano: se una fonte ha l'email e l'altra no, si prende quella;
 *  - di default restano solo i locali dentro le zone turistiche.
 *
 * Il risultato si chiama ristoranti-<citta>.json, cioe' l'ingresso normale
 * dei passi successivi: leggi-siti ed estrai-menu non cambiano di una riga.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const QUI = dirname(fileURLToPath(import.meta.url));
const CARTELLA_DATI = process.env.CARTELLA_DATI ? join(QUI, process.env.CARTELLA_DATI) : join(QUI, 'dati');

const argomenti = process.argv.slice(2);
const valore = (n) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const citta = (valore('--citta') || 'sydney').toLowerCase();
const ovunque = argomenti.includes('--ovunque');

function dominio(u) {
  if (!u) return '';
  try {
    const h = new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.toLowerCase().replace(/^www\./, '');
    // i social non identificano un sito: due locali diversi possono avere
    // due pagine Facebook, ma il dominio sarebbe lo stesso
    if (/facebook|instagram|linktr|linktree|google\.com|business\.site|wixsite|squarespace\.com/.test(h)) return '';
    return h;
  } catch { return ''; }
}

const leggi = (n) => existsSync(join(CARTELLA_DATI, n)) ? JSON.parse(readFileSync(join(CARTELLA_DATI, n), 'utf-8')) : null;

function main() {
  const osm = leggi(`ristoranti-${citta}.json`);
  const fsq = leggi(`foursquare-${citta}.json`);
  if (!fsq) { console.error(`Manca foursquare-${citta}.json. Lancia prima .\\trova-foursquare.ps1`); process.exit(1); }
  if (!osm) { console.error(`Manca ristoranti-${citta}.json.`); process.exit(1); }

  // Copia di sicurezza: l'elenco OpenStreetMap non si perde.
  const salvataggio = join(CARTELLA_DATI, `ristoranti-${citta}-solo-osm.json`);
  if (!existsSync(salvataggio)) {
    copyFileSync(join(CARTELLA_DATI, `ristoranti-${citta}.json`), salvataggio);
    console.log(`(copia di sicurezza dell'elenco OpenStreetMap in ristoranti-${citta}-solo-osm.json)\n`);
  }

  const perDominio = new Map();
  const senzaDominio = [];

  // Prima OpenStreetMap: il suo identificativo ha la precedenza, cosi' i
  // siti gia' letti restano riconoscibili.
  for (const r of osm) {
    const d = dominio(r.sito);
    if (d) perDominio.set(d, { ...r, fonte: 'osm' });
    else senzaDominio.push({ ...r, fonte: 'osm' });
  }

  let uniti = 0, nuovi = 0, emailAggiunte = 0;
  for (const r of fsq) {
    const d = dominio(r.sito);
    if (d && perDominio.has(d)) {
      const esistente = perDominio.get(d);
      // stesso locale: sommiamo quello che manca
      if (!esistente.email && r.email) { esistente.email = r.email; emailAggiunte++; }
      if (!esistente.telefono && r.telefono) esistente.telefono = r.telefono;
      if (!esistente.cucina && r.cucina) esistente.cucina = r.cucina;
      if (!esistente.indirizzo && r.indirizzo) esistente.indirizzo = r.indirizzo;
      esistente.fonte = 'osm+foursquare';
      esistente.fsq_id = r.osm_id;
      uniti++;
    } else if (d) {
      perDominio.set(d, { ...r, fonte: 'foursquare' });
      nuovi++;
    } else {
      senzaDominio.push({ ...r, fonte: 'foursquare' });
    }
  }

  let tutti = [...perDominio.values(), ...senzaDominio];
  const prima = tutti.length;
  if (!ovunque) tutti = tutti.filter(r => r.zona && r.zona !== 'fuori-zona');

  tutti.sort((a, b) => (b.sito ? 1 : 0) - (a.sito ? 1 : 0) || (b.email ? 1 : 0) - (a.email ? 1 : 0) || a.nome.localeCompare(b.nome));

  writeFileSync(join(CARTELLA_DATI, `ristoranti-${citta}.json`), JSON.stringify(tutti, null, 2), 'utf-8');

  const colonne = ['nome', 'tipo', 'cucina', 'indirizzo', 'sito', 'email', 'telefono', 'zona_etichetta', 'fonte', 'lat', 'lon', 'osm_id'];
  const perCsv = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  writeFileSync(join(CARTELLA_DATI, `ristoranti-${citta}.csv`),
    '﻿' + [colonne.join(';'), ...tutti.map(r => colonne.map(c => perCsv(r[c])).join(';'))].join('\r\n'), 'utf-8');

  const conSito = tutti.filter(r => r.sito);
  console.log('─────────────────────────────────────────');
  console.log(`OpenStreetMap:                 ${osm.length} locali`);
  console.log(`Foursquare:                    ${fsq.length} locali`);
  console.log(`  stesso locale nelle due:     ${uniti}`);
  console.log(`  email recuperate dall'unione:${String(emailAggiunte).padStart(5)}`);
  console.log(`  locali nuovi da Foursquare:  ${nuovi}`);
  if (!ovunque) console.log(`  scartati perche' fuori zona: ${prima - tutti.length}`);
  console.log('');
  console.log(`ELENCO UNITO:                  ${tutti.length} locali`);
  console.log(`  con sito web:                ${conSito.length}   <- da leggere`);
  console.log(`  con email gia' nota:         ${tutti.filter(r => r.email).length}`);
  console.log(`\nSalvato come ristoranti-${citta}.json: e' l'ingresso normale di leggi-siti.`);
  console.log(`I 609 siti gia' letti verranno saltati da soli.`);
}

main();
