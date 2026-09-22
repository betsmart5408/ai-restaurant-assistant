/**
 * La catena dei fornitori di IA, configurabile senza toccare il codice.
 *
 * Fino a ieri c'era Groq e basta. Ma i piani gratuiti hanno quote giornaliere,
 * i modelli vengono ritirati, e un provider ogni tanto non risponde: serve
 * poter aggiungere un anello alla catena con tre righe nel .env, non con un
 * deploy.
 *
 * COME SI CONFIGURA
 *
 *   AI_PROVIDERS=groq,cerebras
 *
 *   GROQ_API_KEY=gsk_...
 *   GROQ_URL=https://api.groq.com/openai/v1        (facoltativo)
 *   GROQ_MODELS=                                   (vuoto = li scopre da solo)
 *
 *   CEREBRAS_API_KEY=csk_...
 *   CEREBRAS_URL=https://api.cerebras.ai/v1
 *   CEREBRAS_MODELS=llama3.3-70b
 *
 * Per ogni nome elencato in AI_PROVIDERS si leggono <NOME>_API_KEY,
 * <NOME>_URL e <NOME>_MODELS. Un fornitore senza chiave viene saltato in
 * silenzio, cosi' si puo' lasciare la riga pronta e attivarla quando serve.
 *
 * ORDINE
 *
 * Prima la chiave del RISTORANTE, se ce l'ha: e' la sua quota gratuita, ed e'
 * giusto consumare quella prima della nostra. Poi i fornitori della
 * piattaforma, nell'ordine in cui sono elencati. Claude resta l'ultima rete di
 * sicurezza e vive fuori di qui, in ai-chat.ts.
 *
 * COMPATIBILITA'
 *
 * Senza AI_PROVIDERS nel .env il comportamento e' identico a prima: solo Groq,
 * con i modelli scoperti al volo. Nessuno deve cambiare niente per continuare
 * come sempre.
 *
 * Tutti i fornitori raggiungibili cosi' devono esporre un endpoint compatibile
 * con le API OpenAI: e' il caso di Groq, Cerebras, SambaNova, Mistral, Together
 * e di vLLM se un domani ospitiamo un modello nostro.
 */
import Groq from 'groq-sdk';

export interface Fornitore {
  /** Come si chiama nei log. Non e' un identificatore tecnico. */
  nome: string;
  chiave: string;
  baseURL?: string;
  /** Vuoto = si chiede al fornitore quali modelli ha. */
  modelli: string[];
}

function env(nome: string): string {
  return (process.env[nome] || '').trim();
}

function elenco(valore: string): string[] {
  return valore.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * La catena da provare, in ordine.
 * `chiaveRistorante` e' la chiave personale del ristoratore (Impostazioni IA).
 */
export function catenaFornitori(chiaveRistorante?: string): Fornitore[] {
  const catena: Fornitore[] = [];

  // 1. La quota del ristoratore prima della nostra.
  if (chiaveRistorante && chiaveRistorante.trim()) {
    catena.push({
      nome: 'groq (chiave del ristorante)',
      chiave: chiaveRistorante.trim(),
      baseURL: env('GROQ_URL') || undefined,
      modelli: elenco(env('GROQ_MODELS')),
    });
  }

  // 2. I fornitori della piattaforma.
  const nomi = elenco(env('AI_PROVIDERS'));
  if (nomi.length === 0) {
    // Nessuna configurazione: ci si comporta esattamente come prima.
    const chiave = env('GROQ_API_KEY');
    if (chiave) {
      catena.push({
        nome: 'groq',
        chiave,
        baseURL: env('GROQ_URL') || undefined,
        modelli: elenco(env('GROQ_MODELS')),
      });
    }
    return catena;
  }

  for (const nome of nomi) {
    const P = nome.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const chiave = env(`${P}_API_KEY`);
    if (!chiave) continue;   // riga pronta ma non attiva: si salta in silenzio
    catena.push({
      nome,
      chiave,
      baseURL: env(`${P}_URL`) || undefined,
      modelli: elenco(env(`${P}_MODELS`)),
    });
  }

  return catena;
}

/** Il client da usare per un fornitore. */
export function clientePer(f: Fornitore): Groq {
  // maxRetries 0: la libreria, di suo, su un 429 aspetta e riprova (fino a
  // 20-25 secondi col cliente davanti al telefono). Un fornitore al limite
  // si salta subito: il prossimo della catena risponde in 2 secondi.
  return new Groq({ apiKey: f.chiave, maxRetries: 0, timeout: 20_000, ...(f.baseURL ? { baseURL: f.baseURL } : {}) });
}

/**
 * Riassunto della catena, per il log all'avvio. Le chiavi non si stampano:
 * finiscono nei log di Railway e i log si condividono.
 */
export function descriviCatena(catena: Fornitore[]): string {
  if (catena.length === 0) return '(nessun fornitore configurato)';
  return catena
    .map(f => `${f.nome}${f.baseURL ? ` @ ${f.baseURL}` : ''}${f.modelli.length ? ` [${f.modelli.join(', ')}]` : ''}`)
    .join(' -> ');
}
