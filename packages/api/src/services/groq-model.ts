/**
 * Sceglie da solo un modello disponibile su Groq.
 *
 * I nomi dei modelli vengono ritirati nel tempo: scriverli fissi nel codice
 * significa che un giorno l'assistente e le traduzioni smettono di funzionare
 * senza che nessuno abbia toccato niente. Qui chiediamo a Groq cosa e'
 * disponibile con la chiave in uso e scegliamo il migliore.
 */
import Groq from 'groq-sdk';

// Prima i modelli che rispondono e basta; dopo quelli che "ragionano ad alta
// voce", piu' lenti e che rischiano di far uscire il ragionamento nel testo.
const PREFERENZE = [
  'llama-3.3-70b', 'llama-4', 'maverick', 'llama-3.1-8b', 'gemma',
  'gpt-oss-120b', 'qwen3', 'minimax', 'gpt-oss-20b', 'compound',
];
const ESCLUDI = /whisper|tts|orpheus|guard|embed|rerank|moderation/i;

// una voce per chiave: ristoranti diversi possono avere chiavi diverse
const cache = new Map<string, { modelli: string[]; scadenza: number }>();
const DURATA_CACHE_MS = 10 * 60 * 1000;

export async function modelliDisponibili(groq: Groq, chiave: string): Promise<string[]> {
  if (process.env.GROQ_MODEL) return [process.env.GROQ_MODEL];

  const ora = Date.now();
  const salvato = cache.get(chiave);
  if (salvato && salvato.scadenza > ora) return salvato.modelli;

  try {
    const lista: any = await groq.models.list();
    const ids: string[] = (lista?.data || []).map((m: any) => m.id).filter(Boolean);
    const punteggio = (id: string) => {
      const i = PREFERENZE.findIndex(p => id.toLowerCase().includes(p));
      return i === -1 ? 99 : i;
    };
    const modelli = ids.filter(id => !ESCLUDI.test(id)).sort((a, b) => punteggio(a) - punteggio(b)).slice(0, 3);
    cache.set(chiave, { modelli, scadenza: ora + DURATA_CACHE_MS });
    return modelli;
  } catch {
    return [];
  }
}

/** Il modello migliore disponibile, o null se la chiave non ne consente nessuno. */
export async function scegliModello(groq: Groq, chiave: string): Promise<string | null> {
  const modelli = await modelliDisponibili(groq, chiave);
  return modelli[0] ?? null;
}
