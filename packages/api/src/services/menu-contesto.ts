/**
 * Il menu dentro il prompt: scritto stretto, e quando e' enorme, scelto.
 *
 * Il menu viene rispedito al modello a OGNI messaggio, quindi e' la voce piu'
 * pesante del prompt. Finora partiva come JSON.stringify: 63 piatti facevano
 * ~2.000 token, di cui buona parte erano graffe, virgolette e il nome della
 * categoria ripetuto 63 volte.
 *
 * Due interventi, in quest'ordine:
 *
 *  1. FORMATO COMPATTO — una riga per categoria, la categoria scritta una
 *     volta sola. Stessa identica informazione, meta' dei token. Non si perde
 *     niente, quindi si applica sempre.
 *
 *  2. SELEZIONE — solo per i menu davvero grandi. Si tengono i piatti
 *     attinenti a quello che il cliente ha appena chiesto, piu' una quota per
 *     ogni categoria cosi' il modello continua a vedere la forma del menu e
 *     puo' comporre un percorso di degustazione.
 *
 * Quando la selezione taglia, il prompt DEVE dirlo al modello: un menu
 * parziale senza avviso e' peggio del costo che fa risparmiare, perche' il
 * modello risponderebbe "non ce l'abbiamo" per un piatto che esiste.
 */
import { normalizza } from './risposte-dirette';

export interface PiattoMenu {
  name: string;
  description?: string | null;
  price: number;
  category: string;
  allergens: string[];
}

export interface MenuPerPrompt {
  testo: string;
  parziale: boolean;
  inclusi: number;
  totali: number;
}

// Sotto questa soglia il menu ci sta comodo: si manda intero e non si sceglie
// niente. Sopra, meglio un estratto ragionato che duemila token di elenco.
const SOGLIA_SELEZIONE = 45;
const QUANTI_SE_PARZIALE = 35;
const MINIMO_PER_CATEGORIA = 2;

/** "Carbonara 14.50 [glutine,uova]" */
function voce(p: PiattoMenu): string {
  const prezzo = Number.isFinite(Number(p.price)) ? Number(p.price).toFixed(2) : '';
  const allerg = Array.isArray(p.allergens) ? p.allergens.filter(Boolean) : [];
  return `${p.name}${prezzo ? ' ' + prezzo : ''}${allerg.length ? ` [${allerg.join(',')}]` : ''}`;
}

/** Una riga per categoria: la categoria non si ripete a ogni piatto. */
function scriviCompatto(piatti: PiattoMenu[]): string {
  const perCategoria = new Map<string, PiattoMenu[]>();
  for (const p of piatti) {
    const c = (p.category || 'Menu').trim() || 'Menu';
    if (!perCategoria.has(c)) perCategoria.set(c, []);
    perCategoria.get(c)!.push(p);
  }
  return [...perCategoria.entries()]
    .map(([categoria, elenco]) => `${categoria}: ${elenco.map(voce).join('; ')}`)
    .join('\n');
}

/**
 * Quanto c'entra un piatto con quello che il cliente ha appena scritto.
 * Il nome pesa piu' della categoria, la categoria piu' della descrizione.
 * La descrizione non finisce nel prompt ma qui serve lo stesso: e' il punto
 * dove sta scritto "senza glutine" o "piccante", ed e' gratis usarla.
 */
function punteggio(p: PiattoMenu, parole: Set<string>): number {
  if (parole.size === 0) return 0;
  const pesa = (testo: string, peso: number) => {
    const t = normalizza(testo || '').split(' ').filter(Boolean);
    let n = 0;
    for (const w of t) if (w.length >= 3 && parole.has(w)) n += peso;
    return n;
  };
  return pesa(p.name, 3) + pesa(p.category, 2) + pesa(p.description || '', 1);
}

/**
 * Sceglie i piatti da mettere nel prompt.
 * Prima una quota minima per ogni categoria (cosi' il modello vede sempre
 * tutto il menu in miniatura), poi i piu' attinenti fino al tetto.
 */
function seleziona(piatti: PiattoMenu[], messaggio: string, quanti: number): PiattoMenu[] {
  const parole = new Set(normalizza(messaggio).split(' ').filter(w => w.length >= 3));
  const conPunteggio = piatti.map(p => ({ p, s: punteggio(p, parole) }));

  const scelti = new Set<PiattoMenu>();

  // Quota per categoria: si prendono i piatti col punteggio piu' alto di ogni
  // categoria, e a pari merito i primi che il ristoratore ha ordinato (la
  // query li tira su gia' per sort_order, cioe' l'ordine del menu stampato).
  const perCategoria = new Map<string, typeof conPunteggio>();
  for (const x of conPunteggio) {
    const c = (x.p.category || 'Menu').trim() || 'Menu';
    if (!perCategoria.has(c)) perCategoria.set(c, []);
    perCategoria.get(c)!.push(x);
  }
  for (const elenco of perCategoria.values()) {
    [...elenco].sort((a, b) => b.s - a.s)
      .slice(0, MINIMO_PER_CATEGORIA)
      .forEach(x => scelti.add(x.p));
  }

  // Poi i piu' attinenti, fino al tetto.
  for (const x of [...conPunteggio].sort((a, b) => b.s - a.s)) {
    if (scelti.size >= quanti) break;
    scelti.add(x.p);
  }

  // Si restituiscono nell'ordine originale: il menu deve leggersi come un
  // menu, non come una classifica di pertinenza.
  return piatti.filter(p => scelti.has(p));
}

export function costruisciMenuPerPrompt(
  piatti: PiattoMenu[],
  messaggioCliente: string = '',
): MenuPerPrompt {
  const totali = piatti.length;
  if (totali <= SOGLIA_SELEZIONE) {
    return { testo: scriviCompatto(piatti), parziale: false, inclusi: totali, totali };
  }
  const scelti = seleziona(piatti, messaggioCliente, QUANTI_SE_PARZIALE);
  return { testo: scriviCompatto(scelti), parziale: true, inclusi: scelti.length, totali };
}

/**
 * L'avviso che accompagna un menu tagliato. Senza questo il modello crede che
 * il menu finisca li' e risponde "non ce l'abbiamo" per piatti che esistono.
 */
export function avvisoMenuParziale(m: MenuPerPrompt): string {
  if (!m.parziale) return '';
  return `\nATTENZIONE: qui sopra ci sono ${m.inclusi} piatti dei ${m.totali} del menu, scelti per la domanda in corso.` +
    `\n- Se il cliente chiede un piatto che non vedi elencato, NON dire che non esiste e NON dire che non e' in menu.` +
    `\n- Rispondi che controlli volentieri e chiedigli di dirti il nome, oppure invitalo a scorrere il menu completo qui accanto nell'app.`;
}
