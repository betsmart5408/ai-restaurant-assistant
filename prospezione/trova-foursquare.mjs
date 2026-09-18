/**
 * Cercatore di ristoranti su Foursquare OS Places — alternativa al passo 1.
 *
 *   node prospezione/trova-foursquare.mjs                    (Sydney)
 *   node prospezione/trova-foursquare.mjs --citta melbourne --riquadro -38.0,144.8,-37.7,145.1
 *   node prospezione/trova-foursquare.mjs --citta barcellona --riquadro 41.37,2.14,41.41,2.20 --config zone-barcellona.json
 *   node prospezione/trova-foursquare.mjs --prova            (solo 20 righe, per vedere se il collegamento va)
 *
 * --config indica il file delle zone turistiche da usare per etichettare i
 * risultati (di default zone.json, quello di Sydney). Con una citta' diversa
 * da Sydney va sempre indicato, altrimenti tutto risulta "fuori zona".
 *
 * Interroga il catalogo Iceberg di Foursquare e scrive lo stesso identico
 * formato che produce trova-ristoranti.mjs, cosi' i passi successivi
 * (leggi-siti, estrai-menu) funzionano senza cambiare una riga.
 *
 * Rispetto a OpenStreetMap: copertura migliore, c'e' il campo email, e c'e'
 * date_closed per scartare i locali chiusi. Licenza Apache 2.0.
 *
 * Serve:
 *   npm install @duckdb/node-api
 *   FOURSQUARE_TOKEN=... nel file .env (si genera sul Places Portal)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, '..');
const CARTELLA_DATI = process.env.CARTELLA_DATI ? join(QUI, process.env.CARTELLA_DATI) : join(QUI, 'dati');

const CATALOGO = 'https://catalog.h3-hub.foursquare.com/iceberg';
const MAGAZZINO = 'places';
const TABELLA = 'fsq.datasets.places_os';

const argomenti = process.argv.slice(2);
const valore = (n) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const prova = argomenti.includes('--prova');
const citta = (valore('--citta') || 'sydney').toLowerCase();
const fileConfig = valore('--config') || 'zone.json';

// Riquadro: sud,ovest,nord,est. Se non lo passi, usa l'inviluppo delle zone
// gia' definite in zone.json, allargato di un filo.
function riquadroPredefinito() {
  const daRiga = valore('--riquadro');
  if (daRiga) {
    const n = daRiga.split(',').map(Number);
    if (n.length === 4 && n.every(Number.isFinite)) return n;
    console.error('Il riquadro va scritto cosi: --riquadro sud,ovest,nord,est');
    process.exit(1);
  }
  const zone = JSON.parse(readFileSync(join(QUI, fileConfig), 'utf-8')).zone;
  const sud = Math.min(...zone.map(z => z.riquadro[0]));
  const ovest = Math.min(...zone.map(z => z.riquadro[1]));
  const nord = Math.max(...zone.map(z => z.riquadro[2]));
  const est = Math.max(...zone.map(z => z.riquadro[3]));
  return [sud - 0.02, ovest - 0.02, nord + 0.02, est + 0.02];
}

function token() {
  if (process.env.FOURSQUARE_TOKEN) return process.env.FOURSQUARE_TOKEN;
  const env = join(RADICE, '.env');
  if (!existsSync(env)) return '';
  for (const riga of readFileSync(env, 'utf-8').split('\n')) {
    const t = riga.trim();
    if (t.startsWith('FOURSQUARE_TOKEN=')) return t.slice(17).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

// In quale delle nostre zone turistiche cade questo punto?
function zonaDi(lat, lon, zone) {
  for (const z of zone) {
    const [s, o, n, e] = z.riquadro;
    if (lat >= s && lat <= n && lon >= o && lon <= e) return z;
  }
  return null;
}

function perCsv(v) { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

async function main() {
  const chiave = token();
  if (!chiave) {
    console.error('Manca FOURSQUARE_TOKEN nel file .env.');
    console.error('Generane uno su https://places.foursquare.com -> OS Places -> Generate Token');
    process.exit(1);
  }

  let duck;
  try {
    duck = await import('@duckdb/node-api');
  } catch {
    console.error('Manca la libreria DuckDB. Installala con:\n  npm install @duckdb/node-api');
    process.exit(1);
  }

  const [sud, ovest, nord, est] = riquadroPredefinito();
  const zone = JSON.parse(readFileSync(join(QUI, fileConfig), 'utf-8')).zone;
  if (!existsSync(CARTELLA_DATI)) mkdirSync(CARTELLA_DATI, { recursive: true });

  console.log(`Mi collego al catalogo Foursquare...`);
  const istanza = await duck.DuckDBInstance.create(':memory:');
  const c = await istanza.connect();

  const esegui = async (sql) => { const r = await c.run(sql); return r; };
  const leggi = async (sql) => {
    const r = await c.runAndReadAll(sql);
    return r.getRowObjects();
  };

  try {
    await esegui(`INSTALL iceberg; LOAD iceberg;`);
    await esegui(`INSTALL httpfs; LOAD httpfs;`);
    // Il token non finisce mai stampato: sta solo dentro questa istruzione.
    await esegui(`CREATE OR REPLACE SECRET fsq_secret (TYPE ICEBERG, TOKEN '${chiave.replace(/'/g, "''")}')`);
    await esegui(`ATTACH '${MAGAZZINO}' AS fsq (TYPE ICEBERG, SECRET fsq_secret, ENDPOINT '${CATALOGO}')`);
    console.log('Collegato.\n');
  } catch (e) {
    console.error('\nNon riesco a collegarmi al catalogo Foursquare.');
    console.error(`Errore: ${e.message}`);
    console.error('\nCose da controllare, in ordine:');
    console.error('  - il token e\' scaduto? Ne generi un altro sul Places Portal');
    console.error('  - il token e\' stato incollato per intero nel .env, senza spazi?');
    console.error('  - il computer ha accesso a internet senza proxy aziendale?');
    process.exit(1);
  }

  const limite = prova ? 'LIMIT 20' : '';
  const sql = `
    SELECT
      fsq_place_id, name, website, email, tel,
      address, locality, postcode, country,
      latitude, longitude,
      array_to_string(fsq_category_labels, ' | ') AS categorie,
      date_closed
    FROM ${TABELLA}
    WHERE date_closed IS NULL
      AND name IS NOT NULL
      AND latitude BETWEEN ${sud} AND ${nord}
      AND longitude BETWEEN ${ovest} AND ${est}
      AND array_to_string(fsq_category_labels, ' | ') ILIKE '%Dining and Drinking%'
    ${limite}
  `;

  console.log(`Cerco locali fra ${sud.toFixed(3)},${ovest.toFixed(3)} e ${nord.toFixed(3)},${est.toFixed(3)}`);
  console.log('(la prima interrogazione scarica gli indici: puo\' volerci qualche minuto)\n');

  let righe;
  try {
    righe = await leggi(sql);
  } catch (e) {
    console.error('\nLa richiesta non e\' andata a buon fine.');
    console.error(`Errore: ${e.message}`);
    console.error('\nSe parla di colonne mancanti, lo schema di Foursquare e\' cambiato: mandami questo messaggio.');
    process.exit(1);
  }

  const fuori = righe.map(r => {
    const lat = Number(r.latitude), lon = Number(r.longitude);
    const z = zonaDi(lat, lon, zone);
    const categorie = String(r.categorie ?? '');
    // "Dining and Drinking > Bar > Cocktail Bar" -> teniamo l'ultimo pezzo
    const cucina = categorie.split('|')[0]?.split('>').slice(-1)[0]?.trim() ?? '';
    return {
      osm_id: `fsq/${r.fsq_place_id}`,
      nome: String(r.name ?? '').trim(),
      tipo: /bar|pub|cocktail/i.test(categorie) ? 'bar' : /caf|coffee/i.test(categorie) ? 'cafe' : 'restaurant',
      cucina,
      indirizzo: [r.address, r.locality, r.postcode].filter(Boolean).join(', '),
      sito: String(r.website ?? '').trim(),
      email: String(r.email ?? '').trim(),
      telefono: String(r.tel ?? '').trim(),
      zona: z?.nome ?? 'fuori-zona',
      zona_etichetta: z?.etichetta ?? 'Fuori dalle zone turistiche',
      lat, lon,
      posti_esterni: '',
      orari: '',
      categorie_foursquare: categorie,
    };
  }).filter(r => r.nome);

  const conSito = fuori.filter(r => r.sito);
  const conEmail = fuori.filter(r => r.email);
  const inZona = fuori.filter(r => r.zona !== 'fuori-zona');

  // Ordine: prima chi ha sito, poi per nome — come l'altro cercatore
  fuori.sort((a, b) => (b.sito ? 1 : 0) - (a.sito ? 1 : 0) || a.nome.localeCompare(b.nome));

  const base = prova ? `foursquare-prova-${citta}` : `foursquare-${citta}`;
  writeFileSync(join(CARTELLA_DATI, `${base}.json`), JSON.stringify(fuori, null, 2), 'utf-8');
  const colonne = ['nome', 'tipo', 'cucina', 'indirizzo', 'sito', 'email', 'telefono', 'zona_etichetta', 'lat', 'lon', 'osm_id'];
  writeFileSync(join(CARTELLA_DATI, `${base}.csv`),
    '﻿' + [colonne.join(';'), ...fuori.map(r => colonne.map(x => perCsv(r[x])).join(';'))].join('\r\n'), 'utf-8');

  console.log('─────────────────────────────────────────');
  console.log(`Locali trovati:              ${fuori.length}`);
  console.log(`  con sito web:              ${conSito.length}`);
  console.log(`  con email:                 ${conEmail.length}   <- questo OpenStreetMap non ce l'ha`);
  console.log(`  dentro le zone turistiche: ${inZona.length}`);
  console.log(`\nSalvato in ${join(CARTELLA_DATI, base)}.csv e .json`);

  if (!prova) {
    const percorsoOsm = join(CARTELLA_DATI, `ristoranti-${citta}.json`);
    if (existsSync(percorsoOsm)) {
      const osm = JSON.parse(readFileSync(percorsoOsm, 'utf-8'));
      const dominio = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
      const domOsm = new Set(osm.filter(r => r.sito).map(r => dominio(r.sito)).filter(Boolean));
      const nuovi = conSito.filter(r => !domOsm.has(dominio(r.sito)));
      console.log('\n── Confronto con OpenStreetMap ──');
      console.log(`  OpenStreetMap:  ${osm.length} locali, ${osm.filter(r => r.sito).length} con sito, ${osm.filter(r => r.email).length} con email`);
      console.log(`  Foursquare:     ${fuori.length} locali, ${conSito.length} con sito, ${conEmail.length} con email`);
      console.log(`  Siti NUOVI che OpenStreetMap non aveva: ${nuovi.length}`);
    }
  }

  await c.closeSync?.();
}

main().catch(e => { console.error('\nErrore:', e.message); process.exit(1); });
