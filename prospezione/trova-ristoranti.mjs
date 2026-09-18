/**
 * Cercatore di ristoranti — passo 1 della macchina delle demo.
 *
 *   node prospezione/trova-ristoranti.mjs
 *   node prospezione/trova-ristoranti.mjs --zona bondi-beach
 *   node prospezione/trova-ristoranti.mjs --tutto        (rifa' anche le zone gia' fatte)
 *   node prospezione/trova-ristoranti.mjs --config zone-barcellona.json   (un'altra citta')
 *
 * Interroga OpenStreetMap (Overpass API) sulle zone elencate in zone.json
 * (o nel file indicato con --config) e scrive un elenco di ristoranti in
 * dati/ristoranti-<citta>.csv e .json.
 *
 * Perche' OpenStreetMap e non Google: i dati sono liberi (licenza ODbL), non
 * serve nessuna chiave, non si paga e non si violano condizioni d'uso. La
 * copertura e' piu' scarsa di Google, ma per il nostro filtro va bene: a noi
 * servono i ristoranti che HANNO un sito, e quelli sono quasi sempre mappati.
 *
 * Non serve npm install: usa solo Node (versione 18 o superiore).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const QUI = dirname(fileURLToPath(import.meta.url));
// CARTELLA_DATI puo' essere spostata per le prove, cosi' un test non tocca
// mai i dati veri gia' raccolti.
const CARTELLA_DATI = process.env.CARTELLA_DATI
  ? join(QUI, process.env.CARTELLA_DATI)
  : join(QUI, 'dati');

// Piu' server pubblici: se uno e' sovraccarico si passa al successivo.
// OVERPASS_SERVER permette di puntare a un server finto per le prove.
const SERVER = process.env.OVERPASS_SERVER ? [process.env.OVERPASS_SERVER] : [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

// Questi server sono gratuiti e condivisi da tutto il mondo. Se li si
// martella rispondono 429 ("troppe richieste") e smettono di servirci per
// qualche minuto. Meglio andare piano e finire, che correre e farsi bloccare.
const PAUSA_FRA_ZONE_MS = 20000;      // 20 secondi fra una zona e l'altra
const ATTESA_SE_BLOCCATI_MS = 75000;  // dopo un 429 il server va lasciato respirare
const TENTATIVI_PER_ZONA = 8;

const argomenti = process.argv.slice(2);
const zonaRichiesta = (() => {
  const i = argomenti.indexOf('--zona');
  return i !== -1 ? argomenti[i + 1] : null;
})();
const rifaiTutto = argomenti.includes('--tutto');
const fileConfig = (() => {
  const i = argomenti.indexOf('--config');
  return i !== -1 ? argomenti[i + 1] : 'zone.json';
})();

const attesa = (ms) => new Promise(r => setTimeout(r, ms));

function query(riquadro) {
  const [sud, ovest, nord, est] = riquadro;
  const box = `${sud},${ovest},${nord},${est}`;
  // Prendiamo ristoranti, bar e caffe': in zona turistica servono tutti il
  // menu a stranieri. "fast_food" resta fuori: raramente hanno un menu vero.
  return `[out:json][timeout:180];
(
  node["amenity"~"^(restaurant|cafe|bar|pub)$"](${box});
  way["amenity"~"^(restaurant|cafe|bar|pub)$"](${box});
);
out tags center;`;
}

// Da quale server partire: cambia a ogni zona, cosi' non tocca sempre allo
// stesso incassare la prima richiesta.
let partenza = 0;

// Divide un riquadro in quattro. Serve quando una zona e' troppo densa e il
// server non ce la fa: quattro pezzi piccoli passano dove uno grande fallisce.
function dividi([sud, ovest, nord, est]) {
  const latM = (sud + nord) / 2, lonM = (ovest + est) / 2;
  return [
    [sud, ovest, latM, lonM], [sud, lonM, latM, est],
    [latM, ovest, nord, lonM], [latM, lonM, nord, est],
  ];
}

// Una singola richiesta. Restituisce gli elementi, oppure null se non ce l'ha fatta.
//
// Un risultato VUOTO non viene creduto sulla parola: certi mirror rispondono
// "200 OK, nessun risultato" quando in realta' hanno un problema loro. Prima
// di accettare che una zona sia deserta lo facciamo confermare da un secondo
// server. Se sono d'accordo in due, allora e' vero.
async function unaRichiesta(riquadro, tentativi) {
  const corpo = 'data=' + encodeURIComponent(query(riquadro));
  let vuotiVisti = 0;
  for (let tentativo = 1; tentativo <= tentativi; tentativo++) {
    const server = SERVER[(partenza + tentativo - 1) % SERVER.length];
    const nome = server.split('/')[2];
    try {
      const risposta = await fetch(server, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AI-Restaurant-Assistant/1.0 (ricerca ristoranti; contatto via sito)',
        },
        body: corpo,
        signal: AbortSignal.timeout(200000),
      });
      const testo = await risposta.text();
      if (risposta.ok && testo.trimStart().startsWith('{')) {
        const dati = JSON.parse(testo);
        // ATTENZIONE: quando la richiesta e' troppo pesante Overpass risponde
        // 200 con una lista VUOTA e una nota "remark". Senza questo controllo
        // la zona sembrava riuscita e restituiva zero ristoranti.
        if (dati.remark && /error|timed out|timeout/i.test(dati.remark)) {
          console.log(`   tentativo ${tentativo}/${tentativi}: ${nome} -> richiesta troppo pesante. Aspetto 10s...`);
          await attesa(10000);
          continue;
        }
        const elementi = dati.elements ?? [];
        partenza++;
        if (elementi.length === 0) {
          vuotiVisti++;
          if (vuotiVisti < 2 && tentativo < tentativi) {
            console.log(`   ${nome} dice che la zona e' vuota: chiedo conferma a un altro server...`);
            await attesa(4000);
            continue;
          }
        }
        return elementi;
      }
      const bloccati = risposta.status === 429;
      const pausa = bloccati ? ATTESA_SE_BLOCCATI_MS : 8000 * tentativo;
      console.log(`   tentativo ${tentativo}/${tentativi}: ${nome} -> ${risposta.status}` +
        (bloccati ? ' (ci ha messo in coda). Aspetto ' : ' (occupato). Aspetto ') + Math.round(pausa / 1000) + 's...');
      await attesa(pausa);
    } catch (e) {
      const scaduto = /timeout|abort/i.test(e.message);
      const pausa = 8000 * tentativo;
      console.log(`   tentativo ${tentativo}/${tentativi}: ${nome} -> ` +
        (scaduto ? 'troppo lento' : 'non raggiungibile') + `. Aspetto ${Math.round(pausa / 1000)}s...`);
      await attesa(pausa);
    }
  }
  partenza++;
  return null;
}

async function interroga(riquadro, etichetta, profondita = 0) {
  const elementi = await unaRichiesta(riquadro, profondita === 0 ? TENTATIVI_PER_ZONA : 3);
  if (elementi !== null) return elementi;

  if (profondita < 2) {
    console.log(`   la zona e' troppo densa: la divido in 4 e riprovo...`);
    const pezzi = [];
    for (const sotto of dividi(riquadro)) {
      const parte = await interroga(sotto, etichetta, profondita + 1);
      if (parte) pezzi.push(...parte);
      await attesa(4000);
    }
    if (pezzi.length) return pezzi;
  }

  console.log(`   ATTENZIONE: zona "${etichetta}" saltata. Rilancia piu' tardi: .\\trova-ristoranti.ps1 -Zona ${etichetta}`);
  return null;
}

function normalizza(elemento, zona) {
  const t = elemento.tags ?? {};
  const sito = t.website ?? t['contact:website'] ?? t.url ?? '';
  const via = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return {
    osm_id: `${elemento.type}/${elemento.id}`,
    nome: (t.name ?? '').trim(),
    tipo: t.amenity ?? '',
    cucina: (t.cuisine ?? '').replace(/;/g, ', '),
    indirizzo: [via, t['addr:suburb'] ?? t['addr:city'], t['addr:postcode']].filter(Boolean).join(', '),
    sito: sito.trim(),
    email: (t.email ?? t['contact:email'] ?? '').trim(),
    telefono: (t.phone ?? t['contact:phone'] ?? '').trim(),
    zona: zona.nome,
    zona_etichetta: zona.etichetta,
    lat: elemento.lat ?? elemento.center?.lat ?? '',
    lon: elemento.lon ?? elemento.center?.lon ?? '',
    posti_esterni: t.outdoor_seating ?? '',
    orari: (t.opening_hours ?? '').replace(/;/g, ' /'),
  };
}

function perCsv(valore) {
  const s = String(valore ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const config = JSON.parse(readFileSync(join(QUI, fileConfig), 'utf-8'));
  const citta = config.citta.toLowerCase().replace(/\s+/g, '-');
  if (!existsSync(CARTELLA_DATI)) mkdirSync(CARTELLA_DATI, { recursive: true });

  const percorsoJson = join(CARTELLA_DATI, `ristoranti-${citta}.json`);
  const gia = existsSync(percorsoJson) && !rifaiTutto
    ? JSON.parse(readFileSync(percorsoJson, 'utf-8'))
    : [];
  const perOsmId = new Map(gia.map(r => [r.osm_id, r]));
  const zoneGiaFatte = new Set(gia.map(r => r.zona));

  let zone = config.zone;
  if (zonaRichiesta) {
    zone = zone.filter(z => z.nome === zonaRichiesta);
    if (zone.length === 0) {
      console.error(`Nessuna zona "${zonaRichiesta}". Disponibili:\n  ` + config.zone.map(z => z.nome).join('\n  '));
      process.exit(1);
    }
  } else if (!rifaiTutto) {
    const daFare = zone.filter(z => !zoneGiaFatte.has(z.nome));
    if (daFare.length < zone.length) {
      console.log(`(${zone.length - daFare.length} zone gia' fatte, le salto. Usa --tutto per rifarle.)\n`);
    }
    zone = daFare;
  }

  if (zone.length === 0) {
    console.log('Niente da fare: tutte le zone sono gia' + "' state cercate.");
    return;
  }

  console.log(`Cerco ristoranti a ${config.citta} in ${zone.length} zone.\n`);

  for (const [i, zona] of zone.entries()) {
    process.stdout.write(`[${i + 1}/${zone.length}] ${zona.etichetta}... `);
    const elementi = await interroga(zona.riquadro, zona.nome);
    if (elementi === null) continue;

    let nuovi = 0;
    for (const el of elementi) {
      const r = normalizza(el, zona);
      if (!r.nome) continue;                 // senza nome non ci serve
      if (perOsmId.has(r.osm_id)) continue;  // gia' visto in un'altra zona
      perOsmId.set(r.osm_id, r);
      nuovi++;
    }
    const conSito = elementi.filter(e => e.tags?.website || e.tags?.['contact:website']).length;
    console.log(`${elementi.length} locali nella zona, ${nuovi} nuovi (${conSito} con sito web)`);
    if (elementi.length === 0) {
      console.log('   ATTENZIONE: zona vuota. Se non e\' plausibile, rilanciala da sola piu\' tardi.');
    }

    // salvataggio progressivo: se il computer si spegne non perdi il lavoro
    salva(citta, [...perOsmId.values()]);
    if (i < zone.length - 1) await attesa(PAUSA_FRA_ZONE_MS);
  }

  const tutti = [...perOsmId.values()];
  const conSito = tutti.filter(r => r.sito);
  const conEmail = tutti.filter(r => r.email);

  console.log('\n─────────────────────────────────────────');
  console.log(`Locali trovati in totale:   ${tutti.length}`);
  console.log(`  di cui con sito web:      ${conSito.length}   <- i nostri candidati`);
  console.log(`  di cui con email in OSM:  ${conEmail.length}`);
  console.log(`\nSalvato in prospezione/dati/ristoranti-${citta}.csv (apribile con Excel)`);
  console.log(`            e ristoranti-${citta}.json (per il passo successivo)`);
}

function salva(citta, righe) {
  righe.sort((a, b) => (b.sito ? 1 : 0) - (a.sito ? 1 : 0) || a.nome.localeCompare(b.nome));
  writeFileSync(join(CARTELLA_DATI, `ristoranti-${citta}.json`), JSON.stringify(righe, null, 2), 'utf-8');

  const colonne = ['nome', 'tipo', 'cucina', 'indirizzo', 'sito', 'email', 'telefono', 'zona_etichetta', 'orari', 'lat', 'lon', 'osm_id'];
  const csv = [
    colonne.join(';'),
    ...righe.map(r => colonne.map(c => perCsv(r[c])).join(';')),
  ].join('\r\n');
  // BOM: senza, Excel sbaglia le lettere accentate
  writeFileSync(join(CARTELLA_DATI, `ristoranti-${citta}.csv`), '﻿' + csv, 'utf-8');
}

main().catch(e => { console.error('\nErrore:', e.message); process.exit(1); });
