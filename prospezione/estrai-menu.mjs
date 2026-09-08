/**
 * Lettore di menu — passo 3 della macchina delle demo.
 *
 *   node prospezione/estrai-menu.mjs --limite 5     (prova su pochi)
 *   node prospezione/estrai-menu.mjs                (tutti i candidati)
 *   node prospezione/estrai-menu.mjs --anche-forse  (include i "forse")
 *
 * Prende i candidati usciti dal passo 2, apre la loro pagina del menu, e
 * chiede all'IA di trasformare quel disordine in una lista ordinata di piatti
 * con nome, descrizione, prezzo e categoria.
 *
 * Perche' serve l'IA qui e non altrove: ogni sito scrive il menu a modo suo.
 * Chi mette i prezzi in una tabella, chi in un'immagine, chi li attacca al
 * nome. Nessuna regola fissa regge; leggere e capire e' esattamente il
 * lavoro per cui un modello linguistico e' adatto.
 *
 * Costo: usa Groq sul piano gratuito, una chiamata per ristorante. E' una
 * spesa una tantum in fase di costruzione, non un costo che corre.
 *
 * I menu estratti finiscono in prospezione/menu/<slug>.json, uno per locale.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, '..');
const CARTELLA_DATI = process.env.CARTELLA_DATI ? join(QUI, process.env.CARTELLA_DATI) : join(QUI, 'dati');
// Anche questa spostabile per le prove, cosi' un test non sporca i menu veri.
const CARTELLA_MENU = process.env.CARTELLA_MENU ? join(QUI, process.env.CARTELLA_MENU) : join(QUI, 'menu');

const UA = 'AI-Restaurant-Assistant/1.0 (lettura menu pubblico)';
const GROQ = process.env.GROQ_URL ?? 'https://api.groq.com/openai/v1';
const MAX_CARATTERI_PAGINA = 14000;   // per pagina; unendo piu' menu si arriva al doppio

const argomenti = process.argv.slice(2);
const valore = (n) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const limite = Number(valore('--limite')) || null;
const ancheForse = argomenti.includes('--anche-forse');
const rifai = argomenti.includes('--rifai');
const salvaTesto = argomenti.includes('--salva-testo');   // per capire cosa vede il modello
const citta = (valore('--citta') || 'sydney').toLowerCase();
// Con --claude anche i menu di testo passano da Claude invece che da Groq.
// Piu' veloce (niente attese di 90s per il limite del piano gratuito Groq) e
// piu' preciso; costa ~1-2 centesimi a menu. Serve ANTHROPIC_API_KEY nel .env.
const usaClaudeTesto = argomenti.includes('--claude') || process.env.MOTORE === 'claude';
// Pausa fra un ristorante e l'altro: con Groq gratis serve larga (tetto di
// token al minuto); con Claude basta poco.
const PAUSA_MS = usaClaudeTesto ? 1200 : 6000;

const attesa = (ms) => new Promise(r => setTimeout(r, ms));

// ── Chiave Groq ─────────────────────────────────────────────────────────────
// Cerchiamo in due posti, in ordine: il file .env e il database. La chiave nel
// .env puo' essere vecchia o revocata; quella nel database e' la stessa che usa
// l'assistente sul sito, quindi se il sito funziona quella funziona di sicuro.
function daFileEnv(nome) {
  if (process.env[nome]) return process.env[nome];
  const env = join(RADICE, '.env');
  if (!existsSync(env)) return '';
  for (const riga of readFileSync(env, 'utf-8').split('\n')) {
    const t = riga.trim();
    if (t.startsWith(nome + '=')) return t.slice(nome.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

async function chiaveValida(chiave) {
  if (!chiave) return false;
  try {
    const r = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${chiave}` }, signal: AbortSignal.timeout(20000) });
    return r.ok;
  } catch { return false; }
}

async function chiaviDalDatabase() {
  const url = daFileEnv('DATABASE_URL');
  if (!url) return [];
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url });
    const r = await pool.query(
      `SELECT DISTINCT groq_api_key FROM restaurants
       WHERE groq_api_key IS NOT NULL AND groq_api_key <> ''`
    );
    await pool.end();
    return r.rows.map(x => x.groq_api_key);
  } catch (e) {
    console.log(`   (non sono riuscito a leggere le chiavi dal database: ${e.message})`);
    return [];
  }
}

async function trovaChiave() {
  const daEnv = daFileEnv('GROQ_API_KEY');
  if (await chiaveValida(daEnv)) return daEnv;
  if (daEnv) console.log('La chiave nel file .env non e\' valida (Groq la rifiuta). Cerco nel database...');

  for (const k of await chiaviDalDatabase()) {
    if (await chiaveValida(k)) {
      console.log('Uso la chiave salvata nel database (la stessa dell\'assistente sul sito).\n');
      return k;
    }
  }
  return '';
}

// ── Scelta del modello ──────────────────────────────────────────────────────
// I nomi dei modelli su Groq cambiano e vengono ritirati: invece di
// scriverne uno fisso, chiediamo quali sono disponibili e prendiamo il
// migliore fra quelli che conosciamo.
const PREFERENZE = ['llama-3.3-70b', 'llama-4', 'maverick', 'gpt-oss-120b', 'qwen3', 'llama-3.1-8b', 'gemma'];
// Modelli piccoli: meno bravi, ma con tetti di token molto piu' alti. Su un
// testo gia' ridotto alla zona dei prezzi il lavoro e' facile e bastano.
const RIPIEGHI_VELOCI = ['llama-3.1-8b', 'gemma2-9b', 'llama3-8b', 'gpt-oss-20b'];
let modelloScelto = null;
let modelliDisponibili = [];
let giaRipiegato = false;

// Dopo troppi limiti superati passiamo al modello piccolo per il resto del
// giro: meglio finire con un modello modesto che fermarsi col migliore.
function passaAlVeloce() {
  if (giaRipiegato) return false;
  for (const p of RIPIEGHI_VELOCI) {
    const trovato = modelliDisponibili.find(m => m.includes(p) && !/whisper|tts|guard|vision/i.test(m));
    if (trovato && trovato !== modelloScelto) {
      modelloScelto = trovato;
      giaRipiegato = true;
      console.log(`\n(limite toccato troppe volte: passo a ${trovato}, piu' leggero e con tetti piu' alti)\n`);
      return true;
    }
  }
  return false;
}

async function scegliModello(chiave) {
  if (modelloScelto) return modelloScelto;
  const r = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${chiave}` } });
  if (!r.ok) throw new Error(`Groq non risponde (${r.status}). Controlla GROQ_API_KEY nel file .env`);
  const disponibili = (await r.json()).data.map(m => m.id);
  modelliDisponibili = disponibili;
  for (const p of PREFERENZE) {
    const trovato = disponibili.find(m => m.includes(p) && !/whisper|tts|guard|vision/i.test(m));
    if (trovato) { modelloScelto = trovato; break; }
  }
  if (!modelloScelto) modelloScelto = disponibili.find(m => !/whisper|tts|guard/i.test(m));
  if (!modelloScelto) throw new Error('Nessun modello utilizzabile con questa chiave Groq.');
  console.log(`Modello scelto: ${modelloScelto}\n`);
  return modelloScelto;
}

// Modello che sa "vedere" un'immagine. Serve per i menu che sono una foto o
// una scansione: nessun testo da leggere, ma il modello puo' guardarli.
// Su Groq oggi sono i llama-4 (scout, maverick); i vecchi *-vision sono ritirati.
const PREFERENZE_VISIONE = ['llama-4-scout', 'scout', 'llama-4-maverick', 'maverick', 'llama-4', 'vision'];
let modelloVisione = null;
async function scegliModelloVisione(chiave) {
  if (modelloVisione !== null) return modelloVisione;
  if (!modelliDisponibili.length) { try { await scegliModello(chiave); } catch { /* ignora */ } }
  for (const p of PREFERENZE_VISIONE) {
    const t = modelliDisponibili.find(m => m.toLowerCase().includes(p) && !/whisper|tts|guard|embed/i.test(m));
    if (t) { modelloVisione = t; break; }
  }
  if (modelloVisione === null) modelloVisione = '';   // nessuno: la visione resta spenta
  if (modelloVisione) console.log(`   (modello per le immagini: ${modelloVisione})`);
  return modelloVisione;
}

// Estrae il primo array/oggetto JSON da un testo che potrebbe avere altro attorno
// (a volte il modello aggiunge "Ecco il JSON:" o lo mette in un blocco ```).
// Se il JSON e' troncato (risposta tagliata dal limite di token) prova a
// ripararlo: tiene fino all'ultimo piatto completo e richiude le parentesi.
function jsonDaTesto(raw) {
  if (!raw) return null;
  const senzaFence = raw.replace(/```(?:json)?/gi, '');
  const i = senzaFence.indexOf('{');
  if (i === -1) return null;
  const j = senzaFence.lastIndexOf('}');
  if (j > i) {
    try { return JSON.parse(senzaFence.slice(i, j + 1)); } catch { /* provo a riparare */ }
  }
  // Riparazione di un array troncato: "...{...},{...},{ nome incompl
  const frammento = senzaFence.slice(i);
  const ultimoOggetto = frammento.lastIndexOf('},');
  if (ultimoOggetto > 0) {
    try { return JSON.parse(frammento.slice(0, ultimoOggetto + 1) + ']}'); } catch { /* niente */ }
  }
  return null;
}

// ── Da HTML a testo leggibile ───────────────────────────────────────────────
function testoDallaPagina(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // Prima le entita' numeriche (&#8217; e simili), poi quelle con nome.
    // Senza questo nei menu finivano scritture tipo "dewar&#8217;s".
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&deg;/g, '°')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, MAX_CARATTERI_PAGINA);
}

// ── Lettura dei PDF ─────────────────────────────────────────────────────────
//
// Moltissimi ristoranti mettono il menu in un PDF. Senza saperli leggere
// perdiamo circa quattro candidati su dieci. Serve la libreria pdfjs-dist:
//   npm install pdfjs-dist
// Se manca, lo script lo dice e prosegue con i menu in pagina.
let pdfjs = null, pdfjsProvato = false;

async function caricaPdfjs() {
  if (pdfjsProvato) return pdfjs;
  pdfjsProvato = true;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    console.log('\n(La lettura dei PDF e\' spenta: manca la libreria. Installala con:  npm install pdfjs-dist)\n');
    pdfjs = null;
  }
  return pdfjs;
}

async function testoDalPdf(url) {
  const lib = await caricaPdfjs();
  if (!lib) throw new Error('lettura PDF non disponibile (manca pdfjs-dist)');

  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000), redirect: 'follow' });
  if (!r.ok) throw new Error(`PDF non scaricabile (${r.status})`);
  const dati = new Uint8Array(await r.arrayBuffer());
  if (dati.length > 25 * 1024 * 1024) throw new Error('PDF troppo grande');

  const documento = await lib.getDocument({ data: dati, useSystemFonts: true, isEvalSupported: false }).promise;
  const pezzi = [];
  const quante = Math.min(documento.numPages, 12);   // un menu oltre 12 pagine non esiste
  for (let n = 1; n <= quante; n++) {
    const pagina = await documento.getPage(n);
    const contenuto = await pagina.getTextContent();
    // Ricostruiamo le righe: pdfjs restituisce frammenti sparsi, e un menu
    // letto tutto attaccato diventa illeggibile anche per il modello.
    const righe = new Map();
    for (const el of contenuto.items) {
      if (!el.str || !el.str.trim()) continue;
      const y = Math.round((el.transform?.[5] ?? 0) / 3);   // stessa riga = stessa altezza
      if (!righe.has(y)) righe.set(y, []);
      righe.get(y).push({ x: el.transform?.[4] ?? 0, t: el.str });
    }
    const testoPagina = [...righe.entries()]
      .sort((a, b) => b[0] - a[0])                          // dall'alto in basso
      .map(([, parti]) => parti.sort((a, b) => a.x - b.x).map(x => x.t).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    pezzi.push(testoPagina);
  }
  // A seconda della versione di pdfjs il metodo si chiama destroy o cleanup.
  if (typeof documento.destroy === 'function') await documento.destroy();
  else if (typeof documento.cleanup === 'function') await documento.cleanup();
  return pezzi.join('\n\n').slice(0, MAX_CARATTERI_PAGINA * 2);
}

// ── Menu che sono un'immagine ───────────────────────────────────────────────
//
// Un ristorante su tre, qui, mette il menu come foto o come scansione: nessun
// testo, niente prezzi da leggere. Ma un modello che "vede" puo' guardarlo.
// Prima si raccolgono gli indirizzi delle immagini che sembrano un menu, poi
// si passano al modello di visione.
const IMG_MENU = /menu|food|drink|carta|carte|speisekarte|dish|eat/i;
const IMG_NO = /logo|icon|favicon|sprite|avatar|badge|banner|header|footer|bg-|background|pattern|instagram|facebook|map|pixel|spacer/i;

function immaginiDiMenu(html, base) {
  const trovate = [];
  const aggiungi = (src) => {
    if (!src) return;
    let u; try { u = new URL(src.trim().split(/\s+/)[0], base).href; } catch { return; }
    if (!/^https?:/i.test(u) || !/\.(jpe?g|png|webp)(\?|$)/i.test(u)) return;
    if (IMG_NO.test(u)) return;
    if (!trovate.includes(u)) trovate.push(u);
  };
  // <img ...> con src/alt/class che parlano di menu
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = (/\balt=["']([^"']*)["']/i.exec(tag) || [])[1] || '';
    const cls = (/\bclass=["']([^"']*)["']/i.exec(tag) || [])[1] || '';
    const src = (/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const srcset = (/\bsrcset=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const parla = IMG_MENU.test(alt) || IMG_MENU.test(cls) || IMG_MENU.test(src);
    if (parla) { aggiungi(src); if (srcset) aggiungi(srcset.split(',').pop()); }
  }
  // <a href="....jpg"> con testo/indirizzo che parla di menu
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (IMG_MENU.test(m[1]) || IMG_MENU.test(m[2])) aggiungi(m[1]);
  }
  // Ultima spiaggia: se non abbiamo trovato niente di mirato, prendi le
  // immagini piu' grandi per nome (spesso "menu-1.jpg", "dinner.png"...).
  if (trovate.length === 0) {
    for (const m of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) {
      if (!IMG_NO.test(m[1])) aggiungi(m[1]);
    }
  }
  return trovate.slice(0, 5);
}

function istruzioniImg() { return 'Queste immagini sono il menu di un ristorante. ' + ISTRUZIONI; }

// Scarica un'immagine e la restituisce in base64, con il suo tipo.
// Salta quelle troppo grandi (i modelli le rifiutano oltre ~5 MB).
async function scaricaImmagine(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1024 || buf.length > 4_800_000) return null;   // troppo piccola (icona) o troppo grande
    let tipo = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(tipo)) {
      if (/\.png(\?|$)/i.test(url)) tipo = 'image/png';
      else if (/\.webp(\?|$)/i.test(url)) tipo = 'image/webp';
      else tipo = 'image/jpeg';
    }
    return { media_type: tipo, data: buf.toString('base64') };
  } catch { return null; }
}

// ── Menu-immagine con Groq (llama-4) ────────────────────────────────────────
async function piattiDaImmaginiGroq(urls, chiave) {
  if (!chiave) return null;   // modalita' --claude: niente Groq
  const modello = await scegliModelloVisione(chiave);
  if (!modello) return null;   // questa chiave non ha un modello che vede
  const contenuto = [
    { type: 'text', text: istruzioniImg() },
    ...urls.map(u => ({ type: 'image_url', image_url: { url: u } })),
  ];
  let r, corpoErrore = '';
  for (let tentativo = 1; tentativo <= 4; tentativo++) {
    r = await fetch(`${GROQ}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modello, temperature: 0, messages: [{ role: 'user', content: contenuto }] }),
      signal: AbortSignal.timeout(120000),
    });
    if (r.ok) break;
    corpoErrore = await r.text();
    if (r.status !== 429 || tentativo === 4) break;
    const secondi = secondiDaAspettare(r.headers, corpoErrore);
    process.stdout.write(`(limite Groq visione: aspetto ${Math.round(secondi)}s) `);
    await attesa(secondi * 1000);
  }
  if (!r.ok) throw new Error(`Groq visione ${r.status}: ${corpoErrore.slice(0, 140)}`);
  const dati = jsonDaTesto((await r.json()).choices?.[0]?.message?.content ?? '');
  if (!dati) throw new Error('il modello di visione non ha restituito un menu leggibile');
  return normalizzaPiatti(dati.piatti);
}

// ── Menu di testo con Anthropic (Claude) ────────────────────────────────────
// Usato con --claude al posto di Groq: niente attese per il limite gratuito.
async function piattiDaTestoAnthropic(testo) {
  const chiave = daFileEnv('ANTHROPIC_API_KEY');
  if (!chiave || chiave.length < 20) throw new Error('serve ANTHROPIC_API_KEY nel .env per --claude');
  let r, corpoErrore = '';
  for (let t = 1; t <= 5; t++) {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chiave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELLO_CLAUDE_IMG,
        max_tokens: 8192,
        system: ISTRUZIONI,
        messages: [{ role: 'user', content: 'Pagina del menu:\n\n' + testo }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (r.ok) break;
    corpoErrore = await r.text();
    if ((r.status !== 429 && r.status !== 529 && r.status !== 500) || t === 5) break;
    const s = Math.min(Number(r.headers.get('retry-after')) || 8 * t, 60);
    process.stdout.write(`(limite Claude: aspetto ${Math.round(s)}s) `);
    await attesa(s * 1000);
  }
  if (!r.ok) throw new Error(`Claude ${r.status}: ${corpoErrore.slice(0, 140)}`);
  const corpo = await r.json();
  const t = (corpo.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const dati = jsonDaTesto(t);
  if (!dati) throw new Error('Claude non ha restituito un menu leggibile');
  return normalizzaPiatti(dati.piatti);
}

// ── Menu-immagine con Anthropic (Claude) ────────────────────────────────────
// Groq gratis a volte non ha un modello che vede. Claude sì, e legge i menu
// fotografati molto bene. Costa qualche centesimo a menu: si usa solo come
// ripiego, quando il testo non basta.
const MODELLO_CLAUDE_IMG = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

async function piattiDaImmaginiAnthropic(urls) {
  const chiave = daFileEnv('ANTHROPIC_API_KEY');
  if (!chiave || chiave.length < 20) return null;   // nessuna chiave Anthropic vera

  const immagini = [];
  for (const u of urls.slice(0, 4)) {
    const img = await scaricaImmagine(u);
    if (img) immagini.push({ type: 'image', source: { type: 'base64', ...img } });
  }
  if (immagini.length === 0) throw new Error('immagini del menu non scaricabili');

  let r, corpoErrore = '';
  for (let tentativo = 1; tentativo <= 4; tentativo++) {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': chiave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELLO_CLAUDE_IMG,
        max_tokens: 8192,
        messages: [{ role: 'user', content: [{ type: 'text', text: istruzioniImg() }, ...immagini] }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (r.ok) break;
    corpoErrore = await r.text();
    if ((r.status !== 429 && r.status !== 529) || tentativo === 4) break;
    const secondi = Math.min(Number(r.headers.get('retry-after')) || 15 * tentativo, 90);
    process.stdout.write(`(limite Claude: aspetto ${Math.round(secondi)}s) `);
    await attesa(secondi * 1000);
  }
  if (!r.ok) throw new Error(`Claude visione ${r.status}: ${corpoErrore.slice(0, 140)}`);
  const corpo = await r.json();
  const testo = (corpo.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const dati = jsonDaTesto(testo);
  if (!dati) throw new Error('Claude non ha restituito un menu leggibile');
  return normalizzaPiatti(dati.piatti);
}

// Prova prima Groq (gratis), poi Claude (a pagamento) come ripiego.
async function estraiPiattiDaImmagini(urls, chiave) {
  let erroreGroq = '';
  try {
    const g = await piattiDaImmaginiGroq(urls, chiave);
    if (g && g.length) return g;
  } catch (e) { erroreGroq = e.message; }

  try {
    const a = await piattiDaImmaginiAnthropic(urls);
    if (a && a.length) { process.stdout.write('[Claude] '); return a; }
    if (a === null && erroreGroq) throw new Error(erroreGroq);
    if (a === null) throw new Error('menu in immagine: Groq non ha un modello di visione e manca ANTHROPIC_API_KEY nel .env');
    return a;
  } catch (e) {
    throw new Error(erroreGroq && erroreGroq !== e.message ? `${erroreGroq}; poi ${e.message}` : e.message);
  }
}

// ── PDF che è una scansione ─────────────────────────────────────────────────
// Se pdfjs non ci cava testo (menu fotografato dentro un PDF), mandiamo il PDF
// intero a Claude, che lo "guarda" pagina per pagina. Claude legge i PDF
// scansionati nativamente: niente da installare, niente da convertire.
async function piattiDaPdfAnthropic(pdfUrl) {
  const chiave = daFileEnv('ANTHROPIC_API_KEY');
  if (!chiave || chiave.length < 20) return null;

  const rp = await fetch(pdfUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000), redirect: 'follow' });
  if (!rp.ok) throw new Error(`PDF non scaricabile (${rp.status})`);
  const buf = Buffer.from(await rp.arrayBuffer());
  if (buf.length > 28_000_000) throw new Error('PDF troppo grande per la lettura a immagini');
  const dati64 = buf.toString('base64');

  let r, corpoErrore = '';
  for (let t = 1; t <= 4; t++) {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chiave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELLO_CLAUDE_IMG,
        max_tokens: 8192,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dati64 } },
          { type: 'text', text: istruzioniImg() },
        ] }],
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (r.ok) break;
    corpoErrore = await r.text();
    if ((r.status !== 429 && r.status !== 529) || t === 4) break;
    const s = Math.min(Number(r.headers.get('retry-after')) || 15 * t, 90);
    process.stdout.write(`(limite Claude: aspetto ${Math.round(s)}s) `);
    await attesa(s * 1000);
  }
  if (!r.ok) throw new Error(`Claude PDF ${r.status}: ${corpoErrore.slice(0, 140)}`);
  const corpo = await r.json();
  const testo = (corpo.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const dati = jsonDaTesto(testo);
  if (!dati) throw new Error('Claude non ha letto il PDF come menu');
  return normalizzaPiatti(dati.piatti);
}

// ── Indici di menu ──────────────────────────────────────────────────────────
//
// Molti ristoranti non hanno UNA pagina menu: ne hanno una che dice "scegli
// un menu" e rimanda a Dine-In, Takeaway, Drinks, Set Menu. Se sulla pagina
// non ci sono prezzi ma ci sono link ad altri menu, li seguiamo e uniamo.
const PAROLE_MENU = /\b(menu|menus|food|drinks?|dine|dine-in|takeaway|take-away|a la carte|à la carte|alacarte|wine|wines|cocktails?|lunch|dinner|brunch|breakfast|set menu|degustazione|tasting|pizza|pasta|dessert|antipasti|kids)\b/i;
const NON_MENU = /\b(book|booking|reserve|gift|voucher|contact|about|location|what.?s on|order online|careers|privacy|terms|instagram|facebook)\b/i;

function contaPrezzi(testo) {
  return (testo.match(/(?:\$|AUD\s?|€|£)\s?\d{1,3}(?:[.,]\d{2})?\b/g) ?? []).length;
}

function linkDiMenu(html, base) {
  const fuori = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let url; try { url = new URL(m[1], base).href; } catch { continue; }
    if (!/^https?:/i.test(url)) continue;
    try {
      if (new URL(url).hostname.replace(/^www\./,'') !== new URL(base).hostname.replace(/^www\./,'')) continue;
    } catch { continue; }
    if (url.split('#')[0] === base.split('#')[0]) continue;
    const testo = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (NON_MENU.test(testo)) continue;
    if (!PAROLE_MENU.test(testo) && !PAROLE_MENU.test(url)) continue;
    fuori.push({ url, testo });
  }
  // niente doppioni
  return fuori.filter((l, i, a) => a.findIndex(x => x.url === l.url) === i);
}

// Il vero risparmio: di una pagina intera al modello serve solo la zona dei
// prezzi. Teniamo ogni riga con un prezzo, le due righe prima (nome e
// descrizione stanno spesso sopra) e i titoli di sezione. Il resto -- storia
// del locale, orari, informativa cookie -- e' peso morto che ci fa sbattere
// contro il limite di token.
const RE_PREZZO = /(?:\$|AUD\s?|€|£)\s?\d{1,3}(?:[.,]\d{2})?\b|\b\d{1,3}[.,]\d{2}\b/;

function restringiAlMenu(testo) {
  const righe = testo.split('\n').map(r => r.trim());
  const tieni = new Set();

  righe.forEach((r, i) => {
    if (!RE_PREZZO.test(r)) return;
    tieni.add(i);
    if (i - 1 >= 0) tieni.add(i - 1);
    if (i - 2 >= 0) tieni.add(i - 2);
    if (i + 1 < righe.length) tieni.add(i + 1);   // descrizione a volte sotto
  });

  // Titoli di sezione: righe corte, senza prezzo, spesso in maiuscolo.
  // Servono al modello per dare la categoria giusta ai piatti.
  righe.forEach((r, i) => {
    if (tieni.has(i) || !r || r.length > 40 || RE_PREZZO.test(r)) return;
    const parole = r.split(/\s+/).length;
    const maiuscolo = r === r.toUpperCase() && /[A-Z]/.test(r);
    if (parole <= 4 && (maiuscolo || /^[A-Z]/.test(r))) tieni.add(i);
  });

  const scelte = [...tieni].sort((a, b) => a - b);
  const fuori = [];
  let precedente = -2;
  for (const i of scelte) {
    if (i > precedente + 1) fuori.push('');   // stacco fra blocchi separati
    fuori.push(righe[i]);
    precedente = i;
  }
  const risultato = fuori.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Se il restringimento ha buttato via troppo, meglio il testo alleggerito.
  return risultato.length < 120 ? '' : risultato;
}

// Meno testo mandiamo, meno token consumiamo e meno rischiamo il limite.
// Buttiamo via le righe che non possono contenere un piatto.
function alleggerisci(testo) {
  const righe = testo.split('\n')
    .map(r => r.trim())
    .filter(r => r.length > 1 && r.length < 300)
    .filter(r => /[a-zA-Z\u00C0-\u024F\u4e00-\u9fff]/.test(r))          // deve avere lettere
    .filter(r => !/^(cookie|privacy|copyright|©|all rights reserved|follow us|subscribe|newsletter|share this)/i.test(r));
  // via i doppioni consecutivi (menu di navigazione ripetuti)
  const pulite = righe.filter((r, i) => r !== righe[i - 1]);
  return pulite.join('\n').slice(0, 20000);
}

// Prima prova a restringere alla zona dei prezzi; se resta troppo poco,
// ripiega sul testo semplicemente alleggerito.
// Il tetto era 20000; l'ho abbassato a 9000 insieme al restringimento e
// quello ha tagliato via i prezzi dei menu su piu' pagine. Il restringimento
// gia' riduce molto: il tetto puo' tornare largo.
const TETTO_MODELLO = 24000;

function perIlModello(testo) {
  const stretto = restringiAlMenu(testo);
  const scelto = stretto || alleggerisci(testo);
  return scelto.slice(0, TETTO_MODELLO);
}

const ISTRUZIONI = `Sei un assistente che legge la pagina del menu di un ristorante e ne ricava una lista ordinata di piatti.

Rispondi SOLO con JSON valido, in questa forma esatta:
{"piatti":[{"nome":"...","descrizione":"...","prezzo":0,"categoria":"..."}]}

Regole, tutte importanti:
- Copia i nomi dei piatti ESATTAMENTE come sono scritti. Non tradurre, non correggere, non abbellire.
- "prezzo" e' un numero senza simbolo di valuta. Se il prezzo non c'e', metti 0.
- "descrizione" e' la descrizione che trovi nella pagina. Se non c'e', stringa vuota. NON inventarla.
- "categoria" e' il titolo della sezione in cui il piatto si trova (Entrees, Mains, Desserts, Pizza...). Se non c'e' una sezione, metti "Menu".
- NON inventare piatti. Se la pagina non contiene un menu, rispondi {"piatti":[]}.
- Ignora bevande solo se non hanno prezzo; altrimenti includile con categoria "Drinks".
- Ignora testi di navigazione, orari, indirizzi, informativa sui cookie.`;

// Quanti secondi aspettare quando Groq dice "troppo in fretta".
// Lo dice lui stesso, nell'intestazione retry-after o nel messaggio.
function secondiDaAspettare(intestazioni, corpo) {
  const h = Number(intestazioni.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return Math.min(h + 2, 90);
  const m = corpo.match(/try again in ([\d.]+)\s*(m|s)/i);
  if (m) {
    const n = parseFloat(m[1]);
    return Math.min((m[2].toLowerCase() === 'm' ? n * 60 : n) + 2, 90);
  }
  return 30;
}

let limitiDiFila = 0;

// Ripulitura dei piatti che tornano dal modello: fidarsi senza controllare
// e' come non controllare. Usata sia per il testo sia per le immagini.
function normalizzaPiatti(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(p => ({
      nome: String(p.nome ?? '').trim().slice(0, 120),
      descrizione: String(p.descrizione ?? '').trim().slice(0, 400),
      prezzo: Number.isFinite(Number(p.prezzo)) ? Math.max(0, Number(p.prezzo)) : 0,
      categoria: String(p.categoria ?? 'Menu').trim().slice(0, 60) || 'Menu',
    }))
    .filter(p => p.nome.length >= 2 && p.nome.length <= 120)
    .filter((p, i, a) => a.findIndex(x => x.nome.toLowerCase() === p.nome.toLowerCase()) === i)
    .slice(0, 300);
}

// Un errore 400 "json_validate_failed" vuol dire che il vincolo JSON di Groq
// ha fatto scartare la risposta (spesso perche' troncata): ha senso riprovare
// SENZA quel vincolo e ripescare il JSON dal testo. Un 413 vuol dire che
// abbiamo mandato troppo: si riprova con meta' testo.
async function estraiPiatti(testo, chiave, opz = {}) {
  const { jsonMode = true, dimezzamenti = 0 } = opz;

  // Modalita' --claude: salta Groq, va dritto a Claude sul testo.
  if (usaClaudeTesto) return piattiDaTestoAnthropic(testo);

  const modello = await scegliModello(chiave);
  let r, corpoErrore = '';

  const corpo = {
    model: modello,
    temperature: 0,
    messages: [
      { role: 'system', content: ISTRUZIONI },
      { role: 'user', content: 'Pagina del menu:\n\n' + testo },
    ],
  };
  if (jsonMode) corpo.response_format = { type: 'json_object' };

  // Fino a 4 tentativi: il piano gratuito di Groq ha un tetto di token al
  // minuto, e con menu di piu' pagine lo si tocca spesso. Non e' un errore,
  // e' solo il momento di aspettare.
  for (let tentativo = 1; tentativo <= 4; tentativo++) {
    r = await fetch(`${GROQ}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(90000),
    });
    if (r.ok) { limitiDiFila = 0; break; }
    corpoErrore = await r.text();
    if (r.status !== 429 || tentativo === 4) break;
    const secondi = secondiDaAspettare(r.headers, corpoErrore);
    process.stdout.write(`(limite Groq: aspetto ${Math.round(secondi)}s) `);
    await attesa(secondi * 1000);
  }

  if (!r.ok) {
    if (r.status === 429) {
      limitiDiFila++;
      // Tre ristoranti di fila fermati dal limite: cambiamo modello e
      // riproviamo questo, invece di perdere anche i prossimi.
      if (limitiDiFila >= 2 && passaAlVeloce()) {
        limitiDiFila = 0;
        return estraiPiatti(testo, chiave, opz);
      }
      throw new Error('limite di Groq non superato dopo 4 tentativi: riprova fra qualche minuto');
    }
    // JSON mode troppo severo o risposta troncata: riprova a mano una volta.
    if (r.status === 400 && jsonMode && /json[_ ]?validate|validate JSON|failed_generation/i.test(corpoErrore)) {
      process.stdout.write('(riprovo senza vincolo JSON) ');
      return estraiPiatti(testo, chiave, { ...opz, jsonMode: false });
    }
    // Richiesta troppo grande: taglia e riprova, fino a due volte.
    if (r.status === 413 && dimezzamenti < 2 && testo.length > 3000) {
      process.stdout.write('(testo troppo grande: dimezzo) ');
      return estraiPiatti(testo.slice(0, Math.floor(testo.length * 0.55)), chiave, { ...opz, dimezzamenti: dimezzamenti + 1 });
    }
    throw new Error(`Groq ${r.status}: ${corpoErrore.slice(0, 160)}`);
  }

  const risposta = (await r.json()).choices?.[0]?.message?.content ?? '{}';
  const dati = jsonMode
    ? (() => { try { return JSON.parse(risposta); } catch { return jsonDaTesto(risposta); } })()
    : jsonDaTesto(risposta);
  if (!dati) {
    // ancora niente JSON: se eravamo in JSON mode proviamo il giro "a mano"
    if (jsonMode) return estraiPiatti(testo, chiave, { ...opz, jsonMode: false });
    throw new Error('Il modello non ha restituito JSON valido');
  }
  return normalizzaPiatti(dati.piatti);
}

function slugDi(nome, osmId) {
  const base = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return base || 'locale-' + osmId.replace(/\W/g, '');
}

async function main() {
  if (usaClaudeTesto) {
    if (!daFileEnv('ANTHROPIC_API_KEY') || daFileEnv('ANTHROPIC_API_KEY').length < 20) {
      console.error('\n--claude richiede ANTHROPIC_API_KEY nel file .env. Prendila su https://console.anthropic.com');
      process.exit(1);
    }
    console.log('Modalita\' --claude: i menu (testo, foto e PDF) li legge Claude. Groq non serve.\n');
  }
  const chiave = usaClaudeTesto ? '' : await trovaChiave();
  if (!usaClaudeTesto && !chiave) {
    console.error('\nNessuna chiave Groq utilizzabile.');
    console.error('  - quella nel file .env viene rifiutata (o non c\'e\')');
    console.error('  - nel database non ce n\'e\' una valida');
    console.error('\nPrendine una nuova gratis su https://console.groq.com/keys');
    console.error('e incollala nel file .env alla riga GROQ_API_KEY=');
    console.error('\nOppure lancia con --claude per usare Claude al posto di Groq.');
    process.exit(1);
  }

  const percorso = join(CARTELLA_DATI, `siti-${citta}.json`);
  if (!existsSync(percorso)) { console.error(`Manca ${percorso}. Lancia prima .\\leggi-siti.ps1`); process.exit(1); }
  if (!existsSync(CARTELLA_MENU)) mkdirSync(CARTELLA_MENU, { recursive: true });

  const siti = JSON.parse(readFileSync(percorso, 'utf-8'));
  let candidati = siti.filter(r => r.candidato === 'SI' || (ancheForse && r.candidato === 'forse'));
  candidati = candidati.filter(r => r.pagina_menu || r.menu_pdf);   // serve almeno una pagina o un PDF

  const gia = new Set(readdirSync(CARTELLA_MENU).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)));
  if (!rifai) {
    candidati = candidati.filter(r => {
      const slug = slugDi(r.nome, r.osm_id);
      if (!gia.has(slug)) return true;
      // un tentativo fallito va ritentato al giro dopo
      try {
        const vecchio = JSON.parse(readFileSync(join(CARTELLA_MENU, `${slug}.json`), 'utf-8'));
        return vecchio.esito === 'non riuscito';
      } catch { return true; }
    });
  }
  if (limite) candidati = candidati.slice(0, limite);

  if (candidati.length === 0) {
    console.log('Niente da estrarre. (Usa --anche-forse per includere i dubbi, --rifai per rileggere.)');
    return;
  }

  console.log(`${candidati.length} menu da leggere.\n`);
  const riepilogo = [];

  for (const [i, r] of candidati.entries()) {
    const slug = slugDi(r.nome, r.osm_id);
    process.stdout.write(`[${i + 1}/${candidati.length}] ${r.nome.slice(0, 32).padEnd(32)} `);
    try {
      // Solo PDF, nessuna pagina html: si va dritti al PDF.
      if (!r.pagina_menu && r.menu_pdf) {
        let piattiPdf = [];
        let fontePdf = 'pdf';
        const testoPdf = await testoDalPdf(r.menu_pdf).catch(() => '');
        // Se pdfjs ha cavato del testo, proviamo il modello sul testo.
        if (testoPdf.trim().length >= 250) {
          piattiPdf = await estraiPiatti(perIlModello(testoPdf), chiave);
        }
        // Testo assente o poche righe = e' una scansione: la guarda Claude.
        if (piattiPdf.length < 6) {
          try {
            const daClaude = await piattiDaPdfAnthropic(r.menu_pdf);
            if (daClaude && daClaude.length > piattiPdf.length) { piattiPdf = daClaude; fontePdf = 'pdf-immagine'; process.stdout.write('[Claude PDF] '); }
          } catch (ev) { process.stdout.write(`(Claude PDF: ${ev.message.slice(0, 50)}) `); }
        }
        if (piattiPdf.length === 0) throw new Error('PDF illeggibile (scansione senza testo e Claude non l\'ha letto)');
        const conPrezzoPdf = piattiPdf.filter(p => p.prezzo > 0).length;
        writeFileSync(join(CARTELLA_MENU, `${slug}.json`), JSON.stringify({
          slug, nome: r.nome, email: r.email, sito: r.sito, pagina_menu: r.menu_pdf,
          citta: 'Sydney', paese: 'Australia', cucina: r.cucina, indirizzo: r.indirizzo,
          telefono: r.telefono, zona: r.zona_etichetta, estratto_il: new Date().toISOString().slice(0, 10),
          pagine_lette: 1, fonte: fontePdf, piatti: piattiPdf,
        }, null, 2), 'utf-8');
        console.log(`${String(piattiPdf.length).padStart(3)} piatti (${conPrezzoPdf} con prezzo)  [${fontePdf === 'pdf-immagine' ? 'PDF scansione' : 'dal PDF'}]`);
        riepilogo.push({ slug, nome: r.nome, piatti: piattiPdf.length, conPrezzo: conPrezzoPdf, esito: 'ok' });
        await attesa(PAUSA_MS);
        continue;
      }

      const risposta = await fetch(r.pagina_menu, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(25000), redirect: 'follow',
      });
      if (!risposta.ok) throw new Error(`pagina ${risposta.status}`);
      const htmlMenu = await risposta.text();
      let testo = testoDallaPagina(htmlMenu);
      let paginePrese = 1;

      // Pochi prezzi = probabilmente e' un indice, non il menu vero.
      if (contaPrezzi(testo) < 4) {
        const sotto = linkDiMenu(htmlMenu, risposta.url).slice(0, 4);
        for (const l of sotto) {
          await attesa(900);
          try {
            const r2 = await fetch(l.url, { headers: { 'User-Agent': UA, Accept: 'text/html' },
              signal: AbortSignal.timeout(25000), redirect: 'follow' });
            if (!r2.ok) continue;
            const t2 = testoDallaPagina(await r2.text());
            if (contaPrezzi(t2) >= 3) {
              testo += `\n\n--- ${l.testo || 'altro menu'} ---\n` + t2;
              paginePrese++;
            }
          } catch { /* un sotto-menu che non risponde non ferma il resto */ }
          if (testo.length > MAX_CARATTERI_PAGINA * 2) break;
        }
        testo = testo.slice(0, MAX_CARATTERI_PAGINA * 2);
      }

      // Se la pagina rende poco ma c'e' un PDF del menu, proviamo il testo del PDF.
      if (contaPrezzi(testo) < 3 && r.menu_pdf) {
        const tPdf = await testoDalPdf(r.menu_pdf).catch(() => '');
        if (tPdf.trim().length > testo.trim().length) testo = tPdf;
      }

      let piatti = null;
      let fonte = 'html';

      // I prezzi non sono obbligatori: un menu con nomi e descrizioni, anche
      // senza prezzi, e' comunque una demo valida. L'importante e' leggerlo.
      if (testo.trim().length >= 300) {
        const perModello = perIlModello(testo);
        if (salvaTesto) {
          writeFileSync(join(CARTELLA_MENU, `${slug}.testo-inviato.txt`),
            `--- TESTO GREZZO (${testo.length} caratteri) ---\n${testo}\n\n` +
            `--- MANDATO AL MODELLO (${perModello.length} caratteri) ---\n${perModello}\n`, 'utf-8');
        }
        piatti = await estraiPiatti(perModello, chiave);
      }

      // Ancora poco: il menu e' una foto o una scansione. Prima le immagini
      // dentro la pagina, poi (se c'e' un PDF) il PDF intero letto da Claude.
      if (!piatti || piatti.length < 4) {
        const imgs = immaginiDiMenu(htmlMenu, risposta.url);
        if (imgs.length) {
          process.stdout.write(`(provo con ${imgs.length} immagini) `);
          try {
            const daImg = await estraiPiattiDaImmagini(imgs, chiave);
            if (daImg.length > (piatti?.length ?? 0)) { piatti = daImg; fonte = 'immagine'; }
          } catch (ev) { process.stdout.write(`(visione: ${ev.message.slice(0, 50)}) `); }
        }
      }
      if ((!piatti || piatti.length < 4) && r.menu_pdf) {
        try {
          const daPdf = await piattiDaPdfAnthropic(r.menu_pdf);
          if (daPdf && daPdf.length > (piatti?.length ?? 0)) { piatti = daPdf; fonte = 'pdf-immagine'; process.stdout.write('[Claude PDF] '); }
        } catch (ev) { process.stdout.write(`(Claude PDF: ${ev.message.slice(0, 45)}) `); }
      }

      if (!piatti || piatti.length === 0) {
        throw new Error('nessun menu leggibile: ne\' testo, ne\' immagini, ne\' PDF');
      }

      const conPrezzo = piatti.filter(p => p.prezzo > 0).length;

      writeFileSync(join(CARTELLA_MENU, `${slug}.json`), JSON.stringify({
        slug, nome: r.nome, email: r.email, sito: r.sito, pagina_menu: r.pagina_menu,
        citta: 'Sydney', paese: 'Australia', cucina: r.cucina, indirizzo: r.indirizzo,
        telefono: r.telefono, zona: r.zona_etichetta, estratto_il: new Date().toISOString().slice(0, 10),
        pagine_lette: paginePrese, fonte,
        piatti,
      }, null, 2), 'utf-8');

      console.log(`${String(piatti.length).padStart(3)} piatti (${conPrezzo} con prezzo)` +
        (fonte === 'immagine' ? '  [dalle immagini]' : paginePrese > 1 ? `  [${paginePrese} pagine unite]` : ''));
      riepilogo.push({ slug, nome: r.nome, piatti: piatti.length, conPrezzo, esito: 'ok' });
    } catch (e) {
      console.log(`— non riuscito: ${e.message}`);
      // Scriviamo comunque un file che dice "non riuscito": altrimenti resta
      // in giro il risultato vecchio, magari con l'indirizzo sbagliato, e
      // finirebbe in una demo.
      writeFileSync(join(CARTELLA_MENU, `${slug}.json`), JSON.stringify({
        slug, nome: r.nome, email: r.email, sito: r.sito,
        pagina_menu: r.pagina_menu || r.menu_pdf || '',
        esito: 'non riuscito', motivo: e.message,
        provato_il: new Date().toISOString().slice(0, 10), piatti: [],
      }, null, 2), 'utf-8');
      riepilogo.push({ slug, nome: r.nome, piatti: 0, conPrezzo: 0, esito: e.message });
    }
    await attesa(PAUSA_MS);
  }

  const ok = riepilogo.filter(r => r.esito === 'ok');
  const buoni = ok.filter(r => r.piatti >= 8);              // i prezzi sono un bonus, non un requisito
  const senzaPrezzi = buoni.filter(r => r.conPrezzo === 0).length;
  console.log('\n─────────────────────────────────────────');
  console.log(`Menu letti:                    ${ok.length}/${riepilogo.length}`);
  console.log(`  con almeno 8 piatti:         ${buoni.length}   <- pronti per la demo` +
    (senzaPrezzi ? ` (di cui ${senzaPrezzi} senza prezzi)` : ''));
  console.log(`  troppo corti (<8 piatti):    ${ok.length - buoni.length}`);
  console.log(`  non riusciti:                 ${riepilogo.length - ok.length}`);
  console.log(`\nUn file per locale in ${CARTELLA_MENU}`);
  if (riepilogo.length - ok.length > 0) {
    console.log('\nMotivi dei fallimenti:');
    const m = {};
    riepilogo.filter(r => r.esito !== 'ok').forEach(r => { m[r.esito] = (m[r.esito] || 0) + 1; });
    Object.entries(m).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));
  }
}

main().catch(e => { console.error('\nErrore:', e.message); process.exit(1); });
