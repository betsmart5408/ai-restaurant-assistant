/**
 * Quante delle domande VERE dei clienti sa gia' rispondere il database?
 *
 *   npx tsx packages/api/scripts/analisi-domande-vere.ts
 *
 * Ripesca tutte le domande scritte dai clienti in chat_sessions e le fa
 * ripassare dalla stessa logica che gira in produzione (riconosciConsiglio,
 * rispostaDiretta, chiaveMemoria). Non chiama nessun modello: dice solo chi
 * risponderebbe oggi e, per quelle che finirebbero al modello, perche'.
 *
 * Serve a decidere dove conviene lavorare: con il tetto di cinque chiamate
 * al giorno per ristorante, ogni domanda che il database si riprende vale
 * piu' di qualunque ottimizzazione del prompt.
 */
import 'dotenv/config';
import { db } from '../src/db/client';
import {
  rispostaDiretta, piattiNellaLingua, piattoCitato, normalizza, svuotaCacheTraduzioni,
  type PiattoBase,
} from '../src/services/risposte-dirette';
import { riconosciConsiglio, chiaveMemoria } from '../src/services/consigli-pronti';

// I testi dei NOSTRI pulsanti: in produzione arrivano con `azione`, quindi
// li risolve il database. Nella registrazione resta solo il testo, e senza
// questo controllo risulterebbero come domande da modello.
const NOSTRI_PULSANTI = [
  /^(parlami di|tell me about|cuentame|erzahl mir|parle moi de|fale me de)\b/i,
  /ingredienti, sapore e cosa consigli da bere/i,
  /ingredients, flavou?r and drink pairing/i,
  /^(ho un'allergia o intolleranza alimentare|i have a food allergy)/i,
];

interface Riga { restaurant_id: string; language: string; testo: string }

async function main() {
  const r = await db.query<Riga>(`
    SELECT cs.restaurant_id, coalesce(cs.language, 'it') AS language, m->>'content' AS testo
    FROM chat_sessions cs, jsonb_array_elements(cs.messages) m
    WHERE m->>'role' = 'user' AND coalesce(m->>'content', '') <> ''
      AND ($1::date IS NULL OR cs.created_at::date < $1::date)`, [process.env.PRIMA_DEL || null]);

  // I menu, una volta per ristorante
  const menu = new Map<string, PiattoBase[]>();
  for (const id of new Set(r.rows.map(x => x.restaurant_id))) {
    const d = await db.query<PiattoBase>(
      `SELECT id, name, coalesce(description,'') AS description, price,
              coalesce(category,'') AS category, allergens
       FROM dishes WHERE restaurant_id = $1 AND available = true`, [id]);
    menu.set(id, d.rows);
  }

  const conta = new Map<string, number>();
  const esempi = new Map<string, string[]>();
  const segna = (chi: string, testo: string) => {
    conta.set(chi, (conta.get(chi) ?? 0) + 1);
    const e = esempi.get(chi) ?? [];
    if (e.length < 6 && !e.includes(testo)) e.push(testo);
    esempi.set(chi, e);
  };

  let recuperabili = 0;
  const alModelloTesti: string[] = [];
  const daRecuperare: string[] = [];

  for (const riga of r.rows) {
    const piatti = menu.get(riga.restaurant_id) ?? [];
    const testo = riga.testo.trim();
    if (piatti.length === 0) { segna('menu vuoto (non giudicabile)', testo); continue; }

    if (NOSTRI_PULSANTI.some(re => re.test(testo))) { segna('database: nostri pulsanti', testo); continue; }

    const nomi = piatti.map(d => normalizza(d.name));
    if (riconosciConsiglio(testo, nomi)) { segna('database: consiglio in cache', testo); continue; }

    svuotaCacheTraduzioni();
    const diretta = await rispostaDiretta({
      restaurantId: riga.restaurant_id, dishes: piatti, language: riga.language,
      currency: 'EUR', messaggio: testo,
    });
    if (diretta) { segna(`database: ${diretta.intento}`, testo); continue; }

    if (chiaveMemoria(testo, nomi)) { segna('database: memoria', testo); continue; }

    // Finisce al modello. Si poteva recuperare? Se nomina UN piatto solo e
    // chiede qualcosa che nella scheda c'e' gia' (prezzo, descrizione).
    const risolti = await piattiNellaLingua(riga.restaurant_id, riga.language, piatti);
    const p = piattoCitato(normalizza(testo), risolti);
    const chiedeDati = /quanto costa|prezzo|che prezzo|how much|price|cuanto cuesta|precio|wie viel|combien|quanto custa|com e|com'e|come e|descriv|parlami|racconta|cosa c e|cosa contiene|what is in|what s in|describe|tell me|ingredien/i.test(testo);
    if (p && chiedeDati) {
      recuperabili++;
      if (daRecuperare.length < 10) daRecuperare.push(`${testo}  ->  ${p.nomeMostrato}`);
    }
    alModelloTesti.push(testo);
    segna('MODELLO', testo);
  }

  const tot = r.rows.length;
  console.log(`\n${tot} domande vere scritte dai clienti, dal 20/06 a ieri\n`);
  const ordinate = [...conta.entries()].sort((a, b) => b[1] - a[1]);
  for (const [chi, n] of ordinate) {
    console.log(`  ${chi.padEnd(32)} ${String(n).padStart(4)}  ${(n / tot * 100).toFixed(1).padStart(5)}%`);
  }
  const alModello = conta.get('MODELLO') ?? 0;
  console.log(`\n  DATABASE  ${tot - alModello} su ${tot}  (${((tot - alModello) / tot * 100).toFixed(1)}%)`);
  console.log(`  MODELLO   ${alModello} su ${tot}  (${(alModello / tot * 100).toFixed(1)}%)`);

  console.log(`\n\nCOSA FINISCE AL MODELLO: le piu' ripetute`);
  const gruppi = new Map<string, { quante: number; testo: string }>();
  for (const t of alModelloTesti) {
    const k = normalizza(t).slice(0, 60);
    const g = gruppi.get(k) ?? { quante: 0, testo: t };
    g.quante++; gruppi.set(k, g);
  }
  const top = [...gruppi.values()].sort((a, b) => b.quante - a.quante);
  for (const g of top.slice(0, 28)) console.log(`  ${String(g.quante).padStart(3)}x  ${g.testo.slice(0, 85)}`);
  const unaVolta = top.filter(g => g.quante === 1).length;
  console.log(`\n  domande diverse fra loro: ${gruppi.size} su ${alModello} passaggi`);
  console.log(`  chieste una volta sola:   ${unaVolta} (${(unaVolta / gruppi.size * 100).toFixed(0)}%)`);

  console.log(`\n\nRECUPERABILI SUBITO (nominano un piatto solo e chiedono prezzo o descrizione):`);
  console.log(`  ${recuperabili} domande, cioe' il ${(recuperabili / Math.max(alModello, 1) * 100).toFixed(0)}% di quelle che oggi vanno al modello\n`);
  for (const t of daRecuperare) console.log(`  - ${t.slice(0, 100)}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
