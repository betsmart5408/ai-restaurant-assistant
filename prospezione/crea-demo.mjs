/**
 * Costruisce la demo di un ristorante: la crea nel database con i suoi piatti,
 * i suoi colori e il suo indirizzo, e stampa il link da mandare.
 *
 *   node prospezione/crea-demo.mjs amalfi-restaurant-bondi-beach
 *   node prospezione/crea-demo.mjs amalfi-restaurant-bondi-beach --rifai
 *   node prospezione/crea-demo.mjs --elenco        (quali menu sono pronti)
 *
 * Lo slug nel database prende il prefisso "demo-", cosi' le demo restano
 * distinguibili dai clienti veri e si possono togliere in blocco.
 *
 * Legge le colonne che il database ha DAVVERO invece di fidarsi di quello che
 * ci ricordiamo delle migrazioni: se una colonna non c'e', la salta.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, '..');
const CARTELLA_MENU = join(QUI, 'menu');

const MENU_PUBBLICO = 'https://restaurant-chat-gustobolsa.vercel.app';

const argomenti = process.argv.slice(2);
const valore = (n) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const rifai = argomenti.includes('--rifai');
const soloElenco = argomenti.includes('--elenco');
const nomeFile = argomenti.find(a => !a.startsWith('--') && argomenti[argomenti.indexOf(a) - 1] !== '--sfondo' && argomenti[argomenti.indexOf(a) - 1] !== '--primario');

const MIN_PIATTI = 8;
// I prezzi non sono obbligatori per una demo: conta che il menu sia leggibile
// e abbastanza ricco. Un menu senza prezzi si mostra lo stesso.
const MIN_CON_PREZZO = 0;

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

// Colori: scelti dal tipo di cucina. Il sito calcola da solo se il tema deve
// essere chiaro o scuro dalla luminosita' dello sfondo, quindi entrambi vanno.
const TAVOLOZZE = {
  italian:  { sfondo: '#faf6f0', primario: '#a8321e' },   // sabbia e pomodoro
  pizza:    { sfondo: '#fdf8f2', primario: '#c1440e' },
  japanese: { sfondo: '#f7f5f2', primario: '#2b2b2b' },
  chinese:  { sfondo: '#fdf6f0', primario: '#b3261e' },
  thai:     { sfondo: '#fbf7ee', primario: '#0f7a5a' },
  indian:   { sfondo: '#fdf6ea', primario: '#b35309' },
  lebanese: { sfondo: '#f9f6ef', primario: '#4a6b34' },
  greek:    { sfondo: '#f6f9fb', primario: '#1a5f9e' },
  seafood:  { sfondo: '#f4f8fa', primario: '#15607a' },
  cafe:     { sfondo: '#f8f5f1', primario: '#6b4423' },
  bar:      { sfondo: '#14161c', primario: '#d4a24c' },
  pub:      { sfondo: '#17181c', primario: '#c8873f' },
  steak:    { sfondo: '#1a1614', primario: '#c0562f' },
  default:  { sfondo: '#f8f7f5', primario: '#8a5a3c' },
};

function tavolozzaPer(cucina, nome) {
  const t = ((cucina || '') + ' ' + (nome || '')).toLowerCase();
  for (const [chiave, colori] of Object.entries(TAVOLOZZE)) {
    if (chiave !== 'default' && t.includes(chiave)) return colori;
  }
  if (/steak|grill|bbq/.test(t)) return TAVOLOZZE.steak;
  if (/pizz|osteria|trattoria|amalfi|napoli/.test(t)) return TAVOLOZZE.italian;
  if (/sushi|ramen|izakaya/.test(t)) return TAVOLOZZE.japanese;
  if (/caf|coffee|bake|espresso/.test(t)) return TAVOLOZZE.cafe;
  if (/bar|cocktail|wine/.test(t)) return TAVOLOZZE.bar;
  return TAVOLOZZE.default;
}

// Lingue per l'Australia: i turisti arrivano soprattutto da Cina, Giappone,
// Corea, Indonesia e India. Russo e arabo qui servono molto meno.
const LINGUE = ['en', 'zh', 'ja', 'ko', 'id', 'hi', 'de', 'fr', 'es', 'it'];

function elencoMenuPronti() {
  const fuori = [];
  for (const f of readdirSync(CARTELLA_MENU).filter(x => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(readFileSync(join(CARTELLA_MENU, f), 'utf-8')); } catch { continue; }
    if (j.esito === 'non riuscito') continue;
    const piatti = j.piatti ?? [];
    const conPrezzo = piatti.filter(p => p.prezzo > 0).length;
    fuori.push({ file: f.replace('.json', ''), nome: j.nome, n: piatti.length, conPrezzo,
      pronto: piatti.length >= MIN_PIATTI && conPrezzo >= MIN_CON_PREZZO, zona: j.zona, cucina: j.cucina });
  }
  return fuori.sort((a, b) => (b.pronto ? 1 : 0) - (a.pronto ? 1 : 0) || b.conPrezzo - a.conPrezzo);
}

async function main() {
  if (soloElenco || !nomeFile) {
    const tutti = elencoMenuPronti();
    const pronti = tutti.filter(x => x.pronto);
    console.log(`\nMenu pronti per una demo (almeno ${MIN_PIATTI} piatti, ${MIN_CON_PREZZO} con prezzo):\n`);
    pronti.forEach(x => console.log(`  ${String(x.n).padStart(3)} piatti (${String(x.conPrezzo).padStart(3)} con prezzo)  ${x.nome.slice(0, 34).padEnd(36)} ${x.zona ?? ''}`));
    console.log(`\n  ...e ${tutti.length - pronti.length} menu troppo scarsi, da saltare.`);
    console.log(`\nPer costruirne una:  node prospezione/crea-demo.mjs <nome-file-senza-json>`);
    if (pronti.length) console.log(`Esempio:             node prospezione/crea-demo.mjs ${elencoMenuPronti().find(x=>x.pronto).file}`);
    return;
  }

  const percorso = join(CARTELLA_MENU, `${nomeFile}.json`);
  if (!existsSync(percorso)) { console.error(`Non trovo ${percorso}`); process.exit(1); }
  const menu = JSON.parse(readFileSync(percorso, 'utf-8'));
  const piatti = (menu.piatti ?? []).filter(p => p.nome);
  const conPrezzo = piatti.filter(p => p.prezzo > 0).length;

  if (menu.esito === 'non riuscito') { console.error('Questo menu non era stato estratto.'); process.exit(1); }
  if (piatti.length < MIN_PIATTI || conPrezzo < MIN_CON_PREZZO) {
    console.error(`Menu troppo scarso: ${piatti.length} piatti, ${conPrezzo} con prezzo.`);
    console.error('Una demo con poche righe fa piu\' danno che bene: meglio saltarlo.');
    process.exit(1);
  }

  const url = daEnv('DATABASE_URL');
  if (!url) { console.error('Manca DATABASE_URL nel .env'); process.exit(1); }

  const slug = 'demo-' + menu.slug;
  const colori = {
    sfondo: valore('--sfondo') || tavolozzaPer(menu.cucina, menu.nome).sfondo,
    primario: valore('--primario') || tavolozzaPer(menu.cucina, menu.nome).primario,
  };

  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // Colonne che il database ha davvero: non diamo per scontate le migrazioni.
    const colonne = new Set((await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'restaurants'`
    )).rows.map(r => r.column_name));

    const esistente = await c.query('SELECT id FROM restaurants WHERE slug = $1', [slug]);
    if (esistente.rows.length && !rifai) {
      console.log(`\nLa demo "${slug}" esiste gia'.`);
      console.log(`Link: ${MENU_PUBBLICO}/?restaurant=${slug}`);
      console.log(`\nPer rifarla da capo:  node prospezione/crea-demo.mjs ${nomeFile} --rifai`);
      await c.query('ROLLBACK'); return;
    }

    const campi = {
      name: menu.nome,
      slug,
      city: menu.citta ?? 'Sydney',
      country: menu.paese ?? 'Australia',
      cuisine_type: menu.cucina || null,
      about: `${menu.nome}${menu.indirizzo ? ' — ' + menu.indirizzo : ''}`,
      base_lang: 'en',
      languages: LINGUE,
      currency: 'AUD',
      primary_color: colori.primario,
      background_color: colori.sfondo,
      font_family: 'system',
      billing_email: menu.email || null,
      plan: 'trial',
      subscription_status: 'trialing',
      ai_name: 'Marco',
    };
    // latitudine e longitudine dal file dei siti, se ci sono
    const siti = join(QUI, 'dati', 'ristoranti-sydney.json');
    if (existsSync(siti)) {
      const trovato = JSON.parse(readFileSync(siti, 'utf-8')).find(r => r.nome === menu.nome);
      if (trovato?.lat) { campi.latitude = trovato.lat; campi.longitude = trovato.lon; }
    }

    const usabili = Object.entries(campi).filter(([k]) => colonne.has(k));
    let restaurantId;

    if (esistente.rows.length) {
      restaurantId = esistente.rows[0].id;
      const set = usabili.filter(([k]) => k !== 'slug').map(([k], i) => `${k} = $${i + 1}`);
      await c.query(`UPDATE restaurants SET ${set.join(', ')} WHERE id = $${set.length + 1}`,
        [...usabili.filter(([k]) => k !== 'slug').map(([, v]) => v), restaurantId]);
      await c.query('DELETE FROM dishes WHERE restaurant_id = $1', [restaurantId]);
      console.log(`Rifaccio la demo esistente.`);
    } else {
      const nomi = usabili.map(([k]) => k);
      const segna = nomi.map((_, i) => `$${i + 1}`);
      const r = await c.query(
        `INSERT INTO restaurants (${nomi.join(', ')}) VALUES (${segna.join(', ')}) RETURNING id`,
        usabili.map(([, v]) => v));
      restaurantId = r.rows[0].id;
    }

    // I piatti, nell'ordine del menu originale.
    const colonneDishes = new Set((await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'dishes'`
    )).rows.map(r => r.column_name));
    const haOrdine = colonneDishes.has('sort_order');

    for (const [i, p] of piatti.entries()) {
      const base = ['restaurant_id', 'name', 'description', 'price', 'category'];
      const vals = [restaurantId, p.nome, p.descrizione || '', p.prezzo || 0, p.categoria || 'Menu'];
      if (colonneDishes.has('available')) { base.push('available'); vals.push(true); }
      if (haOrdine) { base.push('sort_order'); vals.push(i); }
      await c.query(
        `INSERT INTO dishes (${base.join(', ')}) VALUES (${base.map((_, k) => '$' + (k + 1)).join(', ')})`,
        vals);
    }

    // L'assistente non parte senza almeno un tavolo registrato.
    for (let n = 1; n <= 3; n++) {
      await c.query(
        `INSERT INTO tables (restaurant_id, number) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [restaurantId, n]);
    }

    await c.query('COMMIT');

    console.log(`\n──────────────────────────────────────────`);
    console.log(`Demo pronta: ${menu.nome}`);
    console.log(`  piatti caricati : ${piatti.length} (${conPrezzo} con prezzo)`);
    console.log(`  colori          : sfondo ${colori.sfondo}, accento ${colori.primario}`);
    console.log(`  lingue previste : ${LINGUE.join(' ')}`);
    console.log(`\n  LINK:  ${MENU_PUBBLICO}/?restaurant=${slug}`);
    console.log(`\nOra mancano le traduzioni. Mettile in database\\traduzioni\\${slug}.<lingua>.json`);
    console.log(`e caricale con:  .\\carica-traduzioni.ps1 -Slug ${slug}`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('\nNon riuscito:', e.message);
    process.exitCode = 1;
  } finally {
    c.release(); await pool.end();
  }
}

main().catch(e => { console.error('Errore:', e.message); process.exit(1); });
