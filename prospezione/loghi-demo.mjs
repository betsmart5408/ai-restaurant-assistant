/**
 * Prende il logo dal sito VERO di ogni ristorante e lo mette nella sua demo.
 *
 *   node prospezione/loghi-demo.mjs                tutte le demo senza logo
 *   node prospezione/loghi-demo.mjs --limite 20    prova su poche
 *   node prospezione/loghi-demo.mjs --slug al-aseel
 *   node prospezione/loghi-demo.mjs --rifai        rifà anche quelle che un logo ce l'hanno
 *   node prospezione/loghi-demo.mjs --riprendi     rifà tutte TRANNE quelle già rifatte nelle ultime 36 h
 *                                                  (per riprendere un --rifai interrotto)
 *
 * Come lo trova, in ordine di qualità:
 *   1. <link rel="apple-touch-icon">  (quasi sempre è il logo pulito, quadrato)
 *   2. logo dichiarato in schema.org (ld+json)
 *   3. <img> nell'header/nav con "logo" in class/alt/src
 *   4. og:image  (a volte è una foto, non il logo)
 *   5. <link rel="icon"> grande / favicon
 *
 * Il file finisce in restaurant_logos (BYTEA) e restaurants.logo_url viene
 * puntato a /api/upload/logo/<id>, esattamente come fa il caricamento a mano
 * dalla dashboard.
 *
 * Inoltre adatta i colori della demo al logo: ricava il colore-accento
 * dominante del logo e lo mette in primary_color, con un background_color
 * bianco appena tinto dello stesso tono. Con --no-colori si salta e restano
 * i colori scelti per tipo di cucina.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import pg from 'pg';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, '..');
const CARTELLA_MENU = join(QUI, 'menu');
const UA = 'Mozilla/5.0 (compatible; AI-Restaurant-Assistant/1.0; +logo pubblico)';

const argomenti = process.argv.slice(2);
const valore = (n) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const limite = Number(valore('--limite')) || null;
const soloSlug = valore('--slug');
const rifai = argomenti.includes('--rifai');
// Riprende un --rifai interrotto: rifà tutte tranne quelle già aggiornate da poco.
const riprendi = argomenti.includes('--riprendi');
// I colori della demo vengono adattati al logo, salvo --no-colori.
const adattaColori = !argomenti.includes('--no-colori');

const attesa = (ms) => new Promise(r => setTimeout(r, ms));

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

// ── Trova gli indirizzi dei loghi candidati, dal migliore al peggiore ────────
function candidatiLogo(html, baseUrl) {
  const out = [];
  const push = (url, punti) => {
    if (!url) return;
    let u; try { u = new URL(url.trim(), baseUrl).href; } catch { return; }
    if (!/^https?:/i.test(u)) return;
    // Un SVG e' vettoriale: nitido a qualsiasi dimensione. Sempre preferito.
    if (/\.svg(\?|$)/i.test(u)) punti += 60;
    out.push({ u, punti });
  };

  // 1. apple-touch-icon (anche -precomposed, anche con sizes)
  for (const m of html.matchAll(/<link\b[^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)) {
    const href = (/\bhref=["']([^"']+)["']/i.exec(m[0]) || [])[1];
    const sizes = (/\bsizes=["'](\d+)/i.exec(m[0]) || [])[1];
    push(href, 100 + (sizes ? Math.min(Number(sizes) / 10, 20) : 0));
  }

  // 2. schema.org ld+json  ->  "logo": "..."  oppure  "logo": { "url": "..." }
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const cerca = (o) => {
        if (!o || typeof o !== 'object') return;
        if (o.logo) push(typeof o.logo === 'string' ? o.logo : o.logo.url, 90);
        for (const v of Object.values(o)) {
          if (Array.isArray(v)) v.forEach(cerca);
          else if (v && typeof v === 'object') cerca(v);
        }
      };
      cerca(j);
    } catch { /* ld+json rotto: pazienza */ }
  }

  // 3. <img> con "logo" (o "brand") in alt/class/id/src, non icone/pagamenti.
  // Di solito e' il logo alla risoluzione piena: meglio di una apple-touch-icon
  // da 180px, che ingrandita sgrana.
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (n) => (new RegExp(`\\b${n}=["']([^"']*)["']`, 'i').exec(tag) || [])[1] || '';
    const src = attr('src') || attr('data-src') || attr('data-lazy-src');
    const spia = (attr('alt') + ' ' + attr('class') + ' ' + attr('id') + ' ' + src).toLowerCase();
    if (!/logo|brand/.test(spia)) continue;
    if (/icon|payment|visa|master|amex|paypal|badge|sprite|award|star|flag/.test(spia)) continue;
    const dentroHeader = m.index < 4000 || /header|navbar|site-?logo|main-?logo/.test(spia);
    const largo = Number(attr('width')) >= 200 || Number(attr('height')) >= 120;
    push(src, 104 + (dentroHeader ? 8 : 0) + (largo ? 8 : 0));
  }

  // 4. og:image / twitter:image
  for (const m of html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)(?::secure_url)?["'][^>]*>/gi)) {
    push((/\bcontent=["']([^"']+)["']/i.exec(m[0]) || [])[1], 40);
  }

  // 5. <link rel="icon"> (preferisci le grandi), poi shortcut icon
  for (const m of html.matchAll(/<link\b[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/gi)) {
    const href = (/\bhref=["']([^"']+)["']/i.exec(m[0]) || [])[1];
    const sizes = (/\bsizes=["'](\d+)/i.exec(m[0]) || [])[1];
    push(href, 25 + (sizes ? Math.min(Number(sizes) / 10, 25) : 0));
  }

  // 6. favicon di default
  push('/favicon.ico', 10);

  // dedup tenendo il punteggio più alto, poi ordina
  const best = new Map();
  for (const c of out) if (!best.has(c.u) || best.get(c.u) < c.punti) best.set(c.u, c.punti);
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

// ── Link Instagram dalla homepage ──────────────────────────────────────────
const IG_SCARTA = /\/(p|reel|reels|explore|tags|stories|share|accounts|about|developer|legal|privacy|tv)\b/i;
function instagramDa(html) {
  const visti = new Map();   // handle -> conteggio
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/gi)) {
    const h = m[1].toLowerCase();
    if (h.length < 2 || h.length > 30) continue;
    if (IG_SCARTA.test(m[0]) || /^(p|reel|reels|explore|tags|stories|share|accounts)$/.test(h)) continue;
    visti.set(h, (visti.get(h) || 0) + 1);
  }
  if (!visti.size) return null;
  // l'handle citato piu' volte (di solito è quello nel footer / icona social)
  const handle = [...visti.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return `https://instagram.com/${handle}`;
}

function tipoImmagine(buf, contentType) {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (/^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon|avif)$/.test(ct)) return ct;
  // sniff dai primi byte
  if (buf.length > 8) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
    const testa = buf.slice(0, 300).toString('latin1').toLowerCase();
    if (testa.includes('<svg') || (testa.includes('<?xml') && testa.includes('svg'))) return 'image/svg+xml';
  }
  return null;
}

// ── Colore della demo dal logo ─────────────────────────────────────────────
// Decoder PNG minimo (bit-depth 8, non interlacciato): copre la stragrande
// maggioranza dei loghi. Per gli SVG si leggono i colori dal testo. Per il
// resto (jpeg/webp/ico) si lascia la tavolozza per tipo di cucina.
function pixelsDaPng(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let larg = 0, alt = 0, bit = 0, tipo = -1, off = 8;
  const idat = [];
  let plte = null, trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const nome = buf.toString('latin1', off + 4, off + 8);
    const dati = buf.subarray(off + 8, off + 8 + len);
    if (nome === 'IHDR') {
      larg = dati.readUInt32BE(0); alt = dati.readUInt32BE(4);
      bit = dati[8]; tipo = dati[9];
      if (dati[12] !== 0) return null;         // interlacciato: lo saltiamo
    } else if (nome === 'PLTE') plte = dati;
    else if (nome === 'tRNS') trns = dati;
    else if (nome === 'IDAT') idat.push(dati);
    else if (nome === 'IEND') break;
    off += 12 + len;
  }
  if (bit !== 8 || larg < 1 || alt < 1 || larg * alt > 4_000_000) return null;
  const canali = tipo === 2 ? 3 : tipo === 6 ? 4 : tipo === 0 ? 1 : tipo === 4 ? 2 : tipo === 3 ? 1 : 0;
  if (!canali) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const rigaByte = larg * canali;
  if (raw.length < (rigaByte + 1) * alt) return null;
  const out = Buffer.alloc(rigaByte * alt);
  let prev = Buffer.alloc(rigaByte);
  for (let y = 0; y < alt; y++) {
    const filtro = raw[y * (rigaByte + 1)];
    const riga = raw.subarray(y * (rigaByte + 1) + 1, y * (rigaByte + 1) + 1 + rigaByte);
    const cur = out.subarray(y * rigaByte, y * rigaByte + rigaByte);
    for (let i = 0; i < rigaByte; i++) {
      const a = i >= canali ? cur[i - canali] : 0;
      const b = prev[i];
      const c = i >= canali ? prev[i - canali] : 0;
      let v = riga[i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  // trasforma in RGBA
  const px = [];
  for (let y = 0; y < alt; y += Math.max(1, (alt / 80) | 0)) {
    for (let x = 0; x < larg; x += Math.max(1, (larg / 80) | 0)) {
      const p = y * rigaByte + x * canali;
      let r, g, bl, al = 255;
      if (tipo === 3) {
        const idx = out[p]; if (!plte || idx * 3 + 2 >= plte.length) continue;
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; bl = plte[idx * 3 + 2];
        if (trns && idx < trns.length) al = trns[idx];
      } else if (tipo === 0) { r = g = bl = out[p]; }
      else if (tipo === 4) { r = g = bl = out[p]; al = out[p + 1]; }
      else { r = out[p]; g = out[p + 1]; bl = out[p + 2]; if (tipo === 6) al = out[p + 3]; }
      px.push([r, g, bl, al]);
    }
  }
  return px;
}

function coloriDaSvg(buf) {
  const t = buf.toString('utf-8').slice(0, 20000);
  const trovati = [];
  for (const m of t.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    trovati.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]);
  }
  return trovati.length ? trovati : null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const f = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

// Da un logo ricava (colore accento, colore sfondo). null se non ci sono
// colori veri (logo tutto nero/bianco/grigio): meglio la tavolozza per cucina.
function coloreDaImmagine(buf, mime) {
  let px = null;
  if (mime === 'image/png') px = pixelsDaPng(buf);
  else if (mime === 'image/svg+xml') px = coloriDaSvg(buf);
  if (!px || !px.length) return null;

  // Quanto e' "chiaro" il logo nel suo insieme (solo pixel opachi). Serve a
  // decidere se il menu va su fondo chiaro (logo scuro -> si vede) o su fondo
  // scuro (logo chiaro/bianco: su fondo bianco sparirebbe).
  let sommaLuce = 0, opachi = 0;
  for (const [r, g, b, a] of px) {
    if (a < 128) continue;
    sommaLuce += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    opachi++;
  }
  const logoChiaro = opachi > 0 && sommaLuce / opachi > 0.58;

  const secchi = new Map();
  for (const [r, g, b, a] of px) {
    if (a < 128) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 244 && mn > 234) continue;        // bianco
    if (mx < 22) continue;                      // nero
    if (mx - mn < 18) continue;                 // grigio
    const k = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const v = secchi.get(k) || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
    const [, s] = rgbToHsl(r, g, b);
    v.n++; v.r += r; v.g += g; v.b += b; v.sat += s;
    secchi.set(k, v);
  }
  if (!secchi.size) return null;
  // vince il secchio con più peso = frequenza * saturazione media
  let best = null;
  for (const v of secchi.values()) {
    const peso = v.n * (0.3 + (v.sat / v.n));
    if (!best || peso > best.peso) best = { peso, r: v.r / v.n, g: v.g / v.n, b: v.b / v.n };
  }
  let [h, s, l] = rgbToHsl(best.r, best.g, best.b);
  if (s < 0.15) return null;                    // in pratica è grigio
  s = Math.min(Math.max(s, 0.45), 0.9);
  if (logoChiaro) {
    // logo chiaro/bianco -> menu su fondo SCURO ma tinto del colore del logo
    // (non nero), accento più luminoso per staccare sul fondo scuro
    l = Math.min(Math.max(l, 0.52), 0.72);
    return { primario: hslToHex(h, s, l), sfondo: hslToHex(h, 0.38, 0.17) };
  }
  // logo scuro -> menu su fondo quasi bianco tinto dello stesso tono
  l = Math.min(Math.max(l, 0.32), 0.55);
  return { primario: hslToHex(h, s, l), sfondo: hslToHex(h, 0.14, 0.972) };
}

async function scaricaLogo(url) {
  let r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch { return null; }
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024) return null;   // troppo pesante per un logo
  const mime = tipoImmagine(buf, r.headers.get('content-type'));
  if (!mime) return null;
  // Un logo vero pesa qualche KB. Sotto questa soglia è quasi sempre una
  // favicon 16x16 o un pixel di tracciamento: come logo verrebbe sgranato.
  const minByte = mime === 'image/svg+xml' ? 200 : 2200;
  if (buf.length < minByte) return null;
  return { mime, data: buf, url };
}

async function homepageDi(pool, r) {
  const url = (r.demo_sito || '').trim() || (() => {
    try {
      const f = join(CARTELLA_MENU, `${r.slug}.json`);
      return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf-8')).sito || '') : '';
    } catch { return ''; }
  })();
  return url || null;
}

async function main() {
  const dburl = daEnv('DATABASE_URL');
  if (!dburl) { console.error('Manca DATABASE_URL nel .env'); process.exit(1); }

  const pool = new pg.Pool({ connectionString: dburl });

  // Colonne del db reali (non diamo per scontate le migrazioni)
  const colonne = new Set((await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'restaurants'`
  )).rows.map(x => x.column_name));
  const haDemoSito = colonne.has('demo_sito');
  const haIsDemo = colonne.has('is_demo');
  const haLogoUrl = colonne.has('logo_url');
  const haColori = colonne.has('primary_color') && colonne.has('background_color');
  const haInstagram = colonne.has('instagram_url');

  let sql = `SELECT r.id, r.slug, r.name${haDemoSito ? ', r.demo_sito' : ", '' AS demo_sito"}
             FROM restaurants r
             ${haIsDemo ? 'WHERE r.is_demo = TRUE' : 'WHERE 1=1'}`;
  const params = [];
  if (soloSlug) { params.push(soloSlug); sql += ` AND r.slug = $${params.length}`; }
  if (riprendi) {
    // riprende un --rifai interrotto: salta quelle già rifatte da poco
    sql += ` AND NOT EXISTS (SELECT 1 FROM restaurant_logos l WHERE l.restaurant_id = r.id AND l.updated_at > NOW() - INTERVAL '36 hours')`;
  } else if (!rifai) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM restaurant_logos l WHERE l.restaurant_id = r.id)`;
  }
  sql += ' ORDER BY r.name';
  if (limite) sql += ` LIMIT ${limite}`;

  const demo = (await pool.query(sql, params)).rows;
  if (demo.length === 0) { console.log('Niente da fare: tutte le demo hanno già un logo (usa --rifai per rifarle).'); await pool.end(); return; }

  console.log(`${demo.length} demo da guardare.\n`);
  let messi = 0, saltati = 0, coloriMessi = 0, instagramMessi = 0;

  for (const [i, r] of demo.entries()) {
    process.stdout.write(`[${i + 1}/${demo.length}] ${r.name.slice(0, 34).padEnd(34)} `);
    const sito = await homepageDi(pool, r);
    if (!sito) { console.log('— nessun sito noto'); saltati++; continue; }

    let html = '';
    try {
      const resp = await fetch(sito, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (resp.ok) html = await resp.text();
      else { console.log(`— sito ${resp.status}`); saltati++; await attesa(300); continue; }
    } catch { console.log('— sito irraggiungibile'); saltati++; await attesa(300); continue; }

    // Instagram: si prende comunque, anche se poi il logo non si trova.
    let notaIg = '';
    if (haInstagram) {
      const ig = instagramDa(html);
      if (ig) {
        await pool.query('UPDATE restaurants SET instagram_url = $1 WHERE id = $2', [ig, r.id]);
        instagramMessi++;
        notaIg = `  ig:@${ig.split('/').pop()}`;
      }
    }

    // Scarica i primi candidati e tiene il migliore: un SVG vince sempre,
    // altrimenti il file piu' pesante (piu' grande = meno sgranato ingrandito).
    const urls = candidatiLogo(html, sito).slice(0, 5);
    let logo = null;
    for (const u of urls) {
      const scaricato = await scaricaLogo(u);
      if (!scaricato) continue;
      if (scaricato.mime === 'image/svg+xml') { logo = scaricato; break; }
      if (!logo || scaricato.data.length > logo.data.length) logo = scaricato;
    }
    if (!logo) { console.log(`— nessun logo trovato${notaIg}`); saltati++; await attesa(300); continue; }

    try {
      await pool.query(
        `INSERT INTO restaurant_logos (restaurant_id, mime, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (restaurant_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = NOW()`,
        [r.id, logo.mime, logo.data]
      );
      if (haLogoUrl) {
        await pool.query('UPDATE restaurants SET logo_url = $1 WHERE id = $2',
          [`/api/upload/logo/${r.id}?v=${Date.now()}`, r.id]);
      }
      const kb = Math.round(logo.data.length / 1024);
      let notaColore = '';
      if (adattaColori && haColori) {
        const col = coloreDaImmagine(logo.data, logo.mime);
        if (col) {
          await pool.query('UPDATE restaurants SET primary_color = $1, background_color = $2 WHERE id = $3',
            [col.primario, col.sfondo, r.id]);
          notaColore = `  colore ${col.primario}`;
          coloriMessi++;
        }
      }
      console.log(`ok  ${logo.mime.replace('image/', '')} ${kb}KB${notaColore}${notaIg}`);
      messi++;
    } catch (e) {
      console.log(`— errore db: ${e.message}`);
      saltati++;
    }
    await attesa(300);
  }

  console.log(`\n─────────────────────────────`);
  console.log(`Loghi messi:     ${messi}`);
  if (adattaColori) console.log(`Colori adattati: ${coloriMessi}  (gli altri tengono la tavolozza per tipo di cucina)`);
  console.log(`Instagram trovati: ${instagramMessi}`);
  console.log(`Saltati:         ${saltati}  (sito assente/irraggiungibile o nessun logo)`);
  console.log(`\nRilancia .\\deploy-tutto.ps1 per pubblicare l'API con loghi e colori.`);
  await pool.end();
}

main().catch(e => { console.error('Errore:', e.message); process.exit(1); });
