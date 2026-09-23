/**
 * Cancellazione automatica delle conversazioni vecchie.
 *
 * Nelle chat non ci sono solo domande sul menu: ci sono clienti che
 * scrivono "sono celiaco", "sono allergico ai crostacei", "ho
 * un'intolleranza al lattosio". In Europa un'allergia dichiarata e' un dato
 * sanitario, e non c'e' nessun motivo per tenerlo per sempre: dopo il pasto
 * non serve piu' a nessuno.
 *
 * Quello che serve davvero - quante domande, di che tipo, in che lingua,
 * quanti token - sta gia' aggregato e senza testo libero in chat_intenti e
 * consumi_ia. Quelle tabelle non si toccano: le statistiche restano intere
 * anche dopo che le conversazioni sono sparite.
 */
import { db } from '../db/client';

const GIORNI = Number(process.env.GIORNI_CONSERVAZIONE_CHAT);
/** Sotto una settimana non si cancella: un errore di battitura nel .env
 *  non deve poter svuotare il database. */
const MINIMO = 7;

export async function cancellaChatVecchie(opzioni: { giorni?: number; prova?: boolean } = {}): Promise<number> {
  const giorni = opzioni.giorni ?? (Number.isFinite(GIORNI) ? GIORNI : 90);
  if (!Number.isFinite(giorni) || giorni < MINIMO) {
    console.warn(`[pulizia] conservazione a ${giorni} giorni: sotto il minimo di ${MINIMO}, non cancello niente`);
    return 0;
  }
  try {
    const quante = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM chat_sessions WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(giorni)]);
    const n = quante.rows[0]?.n ?? 0;
    if (opzioni.prova) {
      console.log(`[pulizia] cancellerei ${n} conversazioni piu' vecchie di ${giorni} giorni`);
      return n;
    }
    if (n === 0) return 0;
    const r = await db.query(
      `DELETE FROM chat_sessions WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(giorni)]);
    console.log(`[pulizia] cancellate ${r.rowCount ?? 0} conversazioni piu' vecchie di ${giorni} giorni`);
    return r.rowCount ?? 0;
  } catch (err) {
    // Come per i contatori: se la pulizia non riesce, pazienza. Riprova domani.
    console.error('[pulizia] cancellazione non riuscita:', (err as Error)?.message);
    return 0;
  }
}
