/**
 * Prova il motore degli allergeni sui MENU VERI, cucina per cucina.
 *
 *   npx tsx packages/api/scripts/prova-allergeni-menu.ts
 *
 * Va lanciato ogni volta che si toccano le liste di parole o le soglie in
 * risposte-dirette.ts. I test offline (prova-logica.ts) non bastano: quella
 * parte era stata scritta su un menu italiano solo, passava tutti i test, e
 * in produzione consigliava un Riesling a un'allergica al sesamo e il
 * "Calzone Napoletano" a un celiaco. Sono i menu veri che lo dicono.
 *
 * Legge il database, non chiama l'IA: non costa niente.
 * Esce con codice 1 se fra i consigli compare una bevanda.
 */
import 'dotenv/config';
import { db } from '../src/db/client';
import { piattiSenzaAllergeni } from '../src/services/risposte-dirette';

const SOSPETTO = /riesling|pinot|chardonnay|shiraz|gamay|grenache|merlot|sauvignon|prosecco|champagne|cider|sake|junmai|vodka|gin |rum |whisky|beer|lager|ale\b|spritz|negroni|martini|espresso|latte |cappuccino|juice|soda|water/i;

async function main() {
  const r = await db.query<{ slug: string; name: string; cuisine_type: string }>(
    `SELECT slug, name, coalesce(cuisine_type,'?') AS cuisine_type FROM restaurants
     WHERE slug IN ('china-doll','spice-i-am','rk-san-japanese-restaurant','masala-theory',
                    'wockbar-manly','the-colonial-british-indian-cuisine-darl','al-aseel',
                    'gusto-alcazabilla','amalfi-restaurant-bondi-beach','3-wise-monkeys')`);
  const allergeni = [['glutine'], ['crostacei'], ['frutta a guscio'], ['latte'], ['sesamo'], ['arachidi']];
  let bandiere = 0;
  for (const rist of r.rows) {
    const d = await db.query<{ name: string; description: string; category: string }>(
      `SELECT name, coalesce(description,'') AS description, coalesce(category,'') AS category
       FROM dishes WHERE restaurant_id=(SELECT id FROM restaurants WHERE slug=$1) AND available=true`, [rist.slug]);
    console.log(`\n\u2550\u2550 ${rist.name} [${rist.cuisine_type}] — ${d.rows.length} voci`);
    for (const a of allergeni) {
      const s = piattiSenzaAllergeni(d.rows, a);
      if (s.pervasivo) { console.log(`   ${a[0].padEnd(16)} PERVASIVO -> non propone niente (${s.scartati} piatti lo nominano)`); continue; }
      if (s.consigliati.length === 0) { console.log(`   ${a[0].padEnd(16)} niente da proporre`); continue; }
      const nomi = s.consigliati.map(x => x.name);
      const brutti = s.consigliati.filter(x => SOSPETTO.test(x.name) || SOSPETTO.test(x.category));
      if (brutti.length) { bandiere += brutti.length; console.log(`   ${a[0].padEnd(16)} \u26a0 BEVANDE: ${brutti.map(x=>`${x.name} [${x.category}]`).join(' | ')}`); }
      else console.log(`   ${a[0].padEnd(16)} ${nomi.slice(0,4).join(' | ')}${nomi.length>4?' …':''}`);
    }
  }
  console.log(`\n${bandiere === 0 ? 'Nessuna bevanda consigliata come cibo.' : bandiere + ' BEVANDE ANCORA CONSIGLIATE'}`);
  process.exit(bandiere ? 1 : 0);
}
main();
