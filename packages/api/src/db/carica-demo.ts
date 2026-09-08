/**
 * Carica nel prodotto i menu raccolti dalla prospezione, come ristoranti DEMO.
 *
 *   npm run carica-demo --workspace=packages/api
 *   npm run carica-demo --workspace=packages/api -- --slug al-aseel
 *   npm run carica-demo --workspace=packages/api -- --elenco
 *   npm run carica-demo --workspace=packages/api -- --cancella-tutte
 *
 * Perche' nel prodotto e non in pagine a parte: il ristoratore deve vedere la
 * cosa vera, quella che comprerebbe -- schermata delle lingue, menu tradotto,
 * logo e colori suoi -- non un disegnino. E cosi' non ci sono due programmi
 * da tenere allineati.
 *
 * Sicurezza, non negoziabile: questo script tocca SOLO le righe con
 * is_demo = TRUE. Un cliente vero non viene mai cancellato ne' sovrascritto,
 * nemmeno se per sbaglio ha lo stesso slug: in quel caso lo script si ferma.
 *
 * Dopo il caricamento, per ogni ristorante:
 *   npm run translate --workspace=packages/api -- <slug> en
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env.');
  process.exit(1);
}

const CARTELLA_MENU = join(__dirname, '../../../../prospezione/menu');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Le lingue che l'applicazione sa gia' mostrare (vedi UI in customer-chat).
// Il coreano non c'e': non lo mettiamo finche' non c'e' anche li'.
// Lingue scelte sulla provenienza vera dei turisti in Australia: Cina,
// Giappone, Corea, Indonesia, India, piu' i grandi mercati europei.
// (La lista precedente aveva arabo, portoghese e russo: sono le lingue che
// servivano a Malaga, non a Sydney.)
const LINGUE_DEMO = ['en', 'zh', 'ja', 'ko', 'id', 'hi', 'de', 'fr', 'es', 'it'];

const argomenti = process.argv.slice(2);
const valore = (n: string) => { const i = argomenti.indexOf(n); return i !== -1 ? argomenti[i + 1] : null; };
const soloSlug = valore('--slug');
// Soglia sul numero di piatti letti. I prezzi non sono un requisito: un menu
// senza prezzi si mostra lo stesso, l'importante e' che sia leggibile e ricco.
const minimo = Number(valore('--minimo')) || 8;
const soloElenco = argomenti.includes('--elenco');
const cancellaTutte = argomenti.includes('--cancella-tutte');
const soloSlugList = argomenti.includes('--slug-list');
const forzaRifacimento = argomenti.includes('--forza');   // rifa' anche se ci sono traduzioni a mano   // per il ciclo di traduci-demo.ps1
// --solo-nuovi: carica SOLO i menu il cui slug non e' gia' nel database.
// Non tocca (non cancella, non ritraduce) le demo gia' presenti.
const soloNuovi = argomenti.includes('--solo-nuovi');

interface Piatto { nome: string; descrizione?: string; prezzo?: number | string; categoria?: string }
interface Menu {
  slug: string; nome: string; email?: string; sito?: string; cucina?: string;
  indirizzo?: string; telefono?: string; zona?: string; citta?: string; paese?: string;
  piatti: Piatto[];
}

const prezzoValido = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

function leggiMenu(): Menu[] {
  if (!existsSync(CARTELLA_MENU)) { console.error(`Manca ${CARTELLA_MENU}. Lancia prima .\\estrai-menu.ps1`); process.exit(1); }
  let file = readdirSync(CARTELLA_MENU).filter(f => f.endsWith('.json'));
  if (soloSlug) file = file.filter(f => f === soloSlug + '.json');
  const menu: Menu[] = [];
  for (const f of file) {
    try {
      const m = JSON.parse(readFileSync(join(CARTELLA_MENU, f), 'utf-8')) as Menu;
      if (!m?.slug || !m?.nome) continue;
      // Si contano tutti i piatti con un nome. Con --solo-con-prezzi (o il
      // vecchio --anche-senza-prezzi, ora ininfluente) si torna al conteggio
      // dei soli piatti con prezzo.
      const soloConPrezzi = argomenti.includes('--solo-con-prezzi');
      const buoni = (m.piatti || []).filter(p => p?.nome && (!soloConPrezzi || prezzoValido(p.prezzo) !== null));
      if (buoni.length < minimo) continue;
      menu.push({ ...m, piatti: buoni });
    } catch { /* un file rotto non ferma gli altri */ }
  }
  return menu.sort((a, b) => b.piatti.length - a.piatti.length);
}

async function elenco() {
  const r = await db.query(
    `SELECT slug, name, demo_email, demo_creata_il, demo_inviata_il,
            (SELECT COUNT(*) FROM dishes d WHERE d.restaurant_id = r.id) AS piatti,
            (SELECT COUNT(DISTINCT t.lang) FROM dish_translations t
               JOIN dishes d ON d.id = t.dish_id WHERE d.restaurant_id = r.id) AS lingue
       FROM restaurants r WHERE is_demo = TRUE ORDER BY name`);
  if (!r.rows.length) { console.log('\nNessuna demo caricata.'); return; }
  console.log(`\n${r.rows.length} demo nel database:\n`);
  for (const d of r.rows) {
    const inviata = d.demo_inviata_il ? 'inviata' : 'da inviare';
    console.log(`  ${String(d.piatti).padStart(3)} piatti  ${String(d.lingue).padStart(2)} lingue  ${inviata.padEnd(10)} ${d.name}  <${d.demo_email || 'senza email'}>`);
    console.log(`       ?restaurant=${d.slug}`);
  }
}

async function cancellaDemo() {
  const r = await db.query(`DELETE FROM restaurants WHERE is_demo = TRUE RETURNING slug`);
  console.log(`\nCancellate ${r.rowCount} demo. I clienti veri non sono stati toccati.`);
}

async function caricaUno(m: Menu) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Se lo slug esiste gia' ed e' un cliente vero, ci fermiamo qui.
    const esiste = await client.query('SELECT id, is_demo, name FROM restaurants WHERE slug = $1', [m.slug]);
    if (esiste.rows.length && !esiste.rows[0].is_demo) {
      await client.query('ROLLBACK');
      console.log(`  SALTATO  ${m.nome}: lo slug "${m.slug}" e' gia' di un ristorante vero.`);
      return false;
    }
    if (esiste.rows.length) {
      // Rifare la demo la cancella a cascata: piatti e traduzioni comprese.
      // Le traduzioni marcate 'manual' sono state scritte a mano e non si
      // rigenerano: prima di buttarle via bisogna dirlo esplicitamente.
      const aMano = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM dish_translations t
           JOIN dishes d ON d.id = t.dish_id
          WHERE d.restaurant_id = $1 AND t.source = 'manual'`,
        [esiste.rows[0].id]);

      if (aMano.rows[0].n > 0 && !forzaRifacimento) {
        await client.query('ROLLBACK');
        console.log(`  SALTATO  ${m.nome}: ha ${aMano.rows[0].n} traduzioni scritte a mano.`);
        console.log(`           Rifarla le cancellerebbe. Usa --forza se e' davvero quello che vuoi.`);
        return false;
      }
      if (aMano.rows[0].n > 0) {
        console.log(`  ATTENZIONE: butto via ${aMano.rows[0].n} traduzioni fatte a mano (--forza).`);
      }
      await client.query('DELETE FROM restaurants WHERE id = $1 AND is_demo = TRUE', [esiste.rows[0].id]);
    }

    const rest = await client.query(
      `INSERT INTO restaurants
         (name, slug, languages, base_lang, currency, timezone, city, country, cuisine_type,
          is_demo, demo_email, demo_sito, demo_creata_il)
       VALUES ($1,$2,$3,'en','AUD','Australia/Sydney',$4,$5,$6,TRUE,$7,$8,NOW())
       RETURNING id`,
      [m.nome, m.slug, LINGUE_DEMO, m.citta || 'Sydney', m.paese || 'Australia',
       m.cucina || null, m.email || null, m.sito || null]);
    const rid = rest.rows[0].id;

    // Un tavolo solo: la demo si guarda dal telefono, non serve la sala intera.
    await client.query(
      `INSERT INTO tables (restaurant_id, number, qr_code) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING`,
      [rid, `${m.slug}-t1`]);

    let ordine = 0;
    for (const p of m.piatti) {
      const prezzo = prezzoValido(p.prezzo);
      await client.query(
        `INSERT INTO dishes (restaurant_id, name, description, price, category, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rid, p.nome.trim(), (p.descrizione || '').trim(), prezzo ?? 0,
         (p.categoria || '').trim() || 'Menu', ordine++]);
    }

    await client.query('COMMIT');
    console.log(`  ok       ${m.nome}  (${m.piatti.length} piatti)   ?restaurant=${m.slug}`);
    return true;
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.log(`  ERRORE   ${m.nome}: ${e.message}`);
    return false;
  } finally {
    client.release();
  }
}

async function main() {
  if (soloSlugList) {
    const r = await db.query('SELECT slug FROM restaurants WHERE is_demo = TRUE ORDER BY name');
    r.rows.forEach(x => console.log(x.slug));
    return;
  }
  if (soloElenco) { await elenco(); return; }
  if (cancellaTutte) { await cancellaDemo(); return; }

  let menu = leggiMenu();
  if (!menu.length) { console.error(`Nessun menu con almeno ${minimo} piatti.`); process.exit(1); }

  if (soloNuovi) {
    const esistenti = new Set(
      (await db.query('SELECT slug FROM restaurants')).rows.map((r: { slug: string }) => r.slug)
    );
    const prima = menu.length;
    menu = menu.filter(m => !esistenti.has(m.slug));
    console.log(`--solo-nuovi: ${prima - menu.length} demo gia' nel database, salto quelle. Ne restano ${menu.length} da aggiungere.`);
    if (!menu.length) { console.log('Niente di nuovo da caricare.'); return; }
  }

  console.log(`\n${menu.length} menu da caricare come demo:\n`);
  let fatti = 0;
  for (const m of menu) if (await caricaUno(m)) fatti++;

  console.log(`\nCaricate ${fatti} demo su ${menu.length}.`);
  console.log(`\nOra traduci i menu, uno per volta:`);
  menu.slice(0, 3).forEach(m => console.log(`  npm run translate --workspace=packages/api -- ${m.slug} en`));
  if (menu.length > 3) console.log(`  ... (o tutte insieme con .\\traduci-demo.ps1)`);
}

main().then(() => db.end()).catch(e => { console.error('Errore:', e.message); db.end(); process.exit(1); });
