/**
 * Prende il logo dal sito VERO di ogni ristorante e lo mette nella sua demo.
 *
 *   node prospezione/loghi-demo.mjs                tutte le demo senza logo
 *   node prospezione/loghi-demo.mjs --limite 20    prova su poche
 *   node prospezione/loghi-demo.mjs --slug al-aseel
 *   node prospezione/loghi-demo.mjs --rifai        rifà anche quelle che un logo ce l'hanno
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
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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

  // 3. <img> con "logo" (o "brand") in alt/class/id/src, non icone/pagamenti
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (n) => (new RegExp(`\\b${n}=["']([^"']*)["']`, 'i').exec(tag) || [])[1] || '';
    const src = attr('src') || attr('data-src') || attr('data-lazy-src');
    const spia = (attr('alt') + ' ' + attr('class') + ' ' + attr('id') + ' ' + src).toLowerCase();
    if (!/logo|brand/.test(spia)) continue;
    if (/icon|payment|visa|master|amex|paypal|badge|sprite|award|star|flag/.test(spia)) continue;
    // bonus se il tag è nell'header (euristica: compare nei primi 4000 caratteri)
    const dentroHeader = m.index < 4000 || /header|navbar|site-?logo|main-?logo/.test(spia);
    push(src, 75 + (dentroHeader ? 10 : 0));
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

  let sql = `SELECT r.id, r.slug, r.name${haDemoSito ? ', r.demo_sito' : ", '' AS demo_sito"}
             FROM restaurants r
             ${haIsDemo ? 'WHERE r.is_demo = TRUE' : 'WHERE 1=1'}`;
  const params = [];
  if (soloSlug) { params.push(soloSlug); sql += ` AND r.slug = $${params.length}`; }
  if (!rifai) sql += ` AND NOT EXISTS (SELECT 1 FROM restaurant_logos l WHERE l.restaurant_id = r.id)`;
  sql += ' ORDER BY r.name';
  if (limite) sql += ` LIMIT ${limite}`;

  const demo = (await pool.query(sql, params)).rows;
  if (demo.length === 0) { console.log('Niente da fare: tutte le demo hanno già un logo (usa --rifai per rifarle).'); await pool.end(); return; }

  console.log(`${demo.length} demo da guardare.\n`);
  let messi = 0, saltati = 0;

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

    const urls = candidatiLogo(html, sito).slice(0, 8);
    let logo = null;
    for (const u of urls) {
      logo = await scaricaLogo(u);
      if (logo) break;
    }
    if (!logo) { console.log('— nessun logo trovato'); saltati++; await attesa(300); continue; }

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
      console.log(`ok  ${logo.mime.replace('image/', '')} ${kb}KB`);
      messi++;
    } catch (e) {
      console.log(`— errore db: ${e.message}`);
      saltati++;
    }
    await attesa(300);
  }

  console.log(`\n─────────────────────────────`);
  console.log(`Loghi messi:  ${messi}`);
  console.log(`Saltati:      ${saltati}  (sito assente/irraggiungibile o nessun logo)`);
  console.log(`\nRilancia .\\deploy-tutto.ps1 per pubblicare l'API con i loghi.`);
  await pool.end();
}

main().catch(e => { console.error('Errore:', e.message); process.exit(1); });
