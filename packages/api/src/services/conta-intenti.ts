/**
 * Il contatore delle risposte: quante le risolve il database e quante il modello.
 *
 * Esiste per una ragione sola: la stima "sei messaggi su dieci non hanno
 * bisogno dell'IA" e' un calcolo fatto a tavolino, non una misura. Dopo due
 * settimane di traffico vero questa tabella dice il numero giusto, e le
 * decisioni sull'infrastruttura si prendono su quello.
 *
 * Regola: contare non deve MAI rallentare ne' far fallire una risposta al
 * cliente. Si lancia e non si aspetta; se il database non risponde, pazienza,
 * si e' perso un conteggio e non una conversazione.
 */
import { db } from '../db/client';

export type Intento = 'piatto' | 'allergeni' | 'ordine' | 'saluto' | 'modello';

export function registraIntento(
  restaurantId: string,
  intento: Intento,
  lingua: string,
): void {
  if (!restaurantId) return;
  const lang = (lingua || '').slice(0, 8);

  void db.query(
    `INSERT INTO chat_intenti (giorno, restaurant_id, intento, lingua, quanti)
     VALUES (CURRENT_DATE, $1, $2, $3, 1)
     ON CONFLICT (giorno, restaurant_id, intento, lingua)
     DO UPDATE SET quanti = chat_intenti.quanti + 1`,
    [restaurantId, intento, lang],
  ).catch(err => {
    // Nessun throw: il cliente ha gia' avuto la sua risposta.
    // Se la tabella non c'e' ancora (migrazione 018 non applicata) si resta
    // zitti dopo il primo avviso, altrimenti si riempiono i log per niente.
    if (!avvisoDato) {
      avvisoDato = true;
      console.warn('conteggio intenti non riuscito (la chat funziona lo stesso):', err?.message ?? err);
    }
  });
}

let avvisoDato = false;
