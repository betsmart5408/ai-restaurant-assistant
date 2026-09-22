/**
 * Verifica dell'assistente: gli fa le domande tipiche di un cliente e
 * controlla ogni risposta con regole precise. Usa l'API vera, come un cliente.
 *
 *   node packages/api/scripts/verifica-assistente.mjs gusto-alcazabilla
 *   node packages/api/scripts/verifica-assistente.mjs gusto-alcazabilla --lingue it,en
 *
 * Controlli su ogni risposta:
 *  - PROMESSA   l'assistente promette azioni che non puo' fare ("avviso io il personale")
 *  - INVENTATO  un nome in **grassetto** che non e' nel menu (piatti e vini)
 *  - SUGGERIMENTO un pulsante scritto come domanda al cliente ("Cosa vuoi provare?")
 *  - TECNICO    pezzi che il cliente non deve vedere (SUGGESTIONS_JSON, <think>)
 *  - VUOTA      nessuna risposta
 * Esce con codice 1 se trova errori.
 *
 * Ogni domanda che arriva all'IA consuma una chiamata del ristorante (conta nel
 * limite giornaliero e nella pagina Consumi IA).
 */
const API = (process.env.API_URL || 'https://ai-restaurant-assistant-production-449f.up.railway.app').replace(/\/+$/, '');
const argomenti = process.argv.slice(2);
const slug = argomenti.find(a => !a.startsWith('--'));
const iLingue = argomenti.indexOf('--lingue');
const lingue = (iLingue >= 0 ? argomenti[iLingue + 1] : 'it,en').split(',').map(s => s.trim()).filter(Boolean);
if (!slug) {
  console.error('Uso: node packages/api/scripts/verifica-assistente.mjs <slug> [--lingue it,en]');
  process.exit(1);
}

// Ogni conversazione e' una lista di messaggi: quelli dopo il primo hanno
// senso solo con il contesto (es. "che vino ci abbino?" dopo un piatto).
const CONVERSAZIONI = {
  it: [
    ["Ho un'allergia", 'Pasta al ragù'],
    ['Cosa mi consigli?', 'Che vino ci abbino?'],
    ['Menu degustazione per 2'],
    ['Sono vegetariano'],
    ['Cosa c\'è per bambini?'],
    ['Siamo in due, uno è celiaco, cosa ci consigli?'],
    ['Avete il wifi?'],
    ['Posso pagare con la carta?'],
    ['Qual è il piatto più tipico?', 'È piccante?'],
    ['Che vino rosso mi consigli con la carne?'],
    ['Posso ordinare da qui?'],
    ['Puoi chiamare il cameriere?'],
  ],
  en: [
    ['I have a nut allergy, what can I eat?'],
    ['What do you recommend?', 'What wine pairs with this?'],
    ['Tasting menu for 2'],
    ['Anything vegetarian?'],
    ['Do you have a kids menu?'],
    ['Which pasta is the best?'],
    ['Can you tell the waiter we are ready to order?'],
    ['Is the tiramisu homemade?'],
  ],
};

const PROMESSE = /\b(avviso io|avviser[oò]|lo segnalo|faccio verificare|chiamo (io )?il cameriere|informo (io )?il personale|comunico (io )?al personale|i['’]ll (let|tell|inform|notify|call)|i will (let|tell|inform|notify|call)|let the (staff|waiter) know|i['’]ve (told|notified|informed))/i;
const TECNICO = /SUGGESTIONS_JSON|<\/?think>|```/;
const RIVOLTO_AL_CLIENTE = /\b(vuoi|preferisci|desideri|indicami|would you|do you want|do you prefer|what would you)\b/i;
// Domande sul locale a cui l'assistente NON sa rispondere: se dice di si' se lo e' inventato
const DOMANDA_LOCALE = /wifi|wi-fi|carta|card|pagare|pay|parcheggio|parking|prenot|book/i;
const AFFERMA = /^(s[iì]|yes|certo|certamente|of course|sure)\b|accettiamo|we accept|password|[eè] disponibile|is available|abbiamo il wifi|we have (free )?wi/i;

function normalizza(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

async function json(url, opzioni) {
  const r = await fetch(url, opzioni);
  const testo = await r.text();
  try { return { status: r.status, dati: JSON.parse(testo) }; } catch { return { status: r.status, dati: { raw: testo } }; }
}

async function nomiDelMenu(lang) {
  const nomi = new Set();
  for (const l of new Set([lang, 'it', 'en', 'es'])) {
    const { dati } = await json(`${API}/api/menu/${slug}/dishes/translated?lang=${l}`);
    if (Array.isArray(dati)) for (const d of dati) if (d?.name) nomi.add(normalizza(d.name));
  }
  return nomi;
}

// "Bolognese" nel menu, "Spaghetti alla Bolognese" in grassetto: va bene se
// uno contiene l'altro, o se tutte le parole lunghe del grassetto sono nel nome
function esisteNelMenu(nome, nomi) {
  const n = normalizza(nome);
  if (!n || nomi.has(n)) return true;
  for (const m of nomi) {
    if (m.length >= 4 && (n.includes(m) || m.includes(n))) return true;
  }
  const parole = n.split(' ').filter(w => w.length >= 5);
  return parole.length > 0 && [...nomi].some(m => parole.every(w => m.includes(w)));
}

async function main() {
  let errori = 0, risposte = 0;
  const nomeRistorante = (await json(`${API}/api/menu/${slug}`)).dati?.restaurant?.name || slug;
  console.log(`\nVerifica assistente: ${nomeRistorante} (${slug})  lingue: ${lingue.join(', ')}\n`);

  for (const lang of lingue) {
    const conv = CONVERSAZIONI[lang];
    if (!conv) { console.log(`[${lang}] nessuna batteria di domande, salto`); continue; }
    const nomi = await nomiDelMenu(lang);
    nomi.add(normalizza(nomeRistorante));

    for (const messaggi of conv) {
      const sess = await json(`${API}/api/chat/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_slug: slug, table_number: 1, language: lang }),
      });
      const sid = sess.dati?.session_id;
      if (!sid) { console.log(`[${lang}] ✗ sessione non creata: ${JSON.stringify(sess.dati).slice(0, 120)}`); errori++; continue; }

      for (const domanda of messaggi) {
        const t0 = Date.now();
        const r = await json(`${API}/api/chat/${sid}/message`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: domanda, language: lang }),
        });
        const secondi = ((Date.now() - t0) / 1000).toFixed(1);
        const testo = String(r.dati?.message ?? '');
        const sugg = Array.isArray(r.dati?.suggestions) ? r.dati.suggestions : [];
        const problemi = [];
        if (!testo.trim()) problemi.push('VUOTA');
        if (/can.t answer right now|non riesco a rispondere|no puedo responder/i.test(testo)) problemi.push('ERRORE IA (nessun fornitore ha risposto)');
        const promessa = testo.match(PROMESSE);
        if (promessa) problemi.push(`PROMESSA "${promessa[0]}"`);
        if (TECNICO.test(testo)) problemi.push('TECNICO');
        if (/pulsante (dedicato|per chiamare)|button to (call|order)|call button/i.test(testo)) problemi.push('INVENTATO: pulsante che non esiste');
        if (/vegetari/i.test(domanda) && [...testo.matchAll(/\*\*[^*]+\*\*/g)].length < 2) problemi.push('INCOMPLETA: nessun piatto vegetariano elencato');
        if (DOMANDA_LOCALE.test(domanda) && AFFERMA.test(testo.trim())) problemi.push('INVENTATO SUL LOCALE');
        for (const m of testo.matchAll(/\*\*([^*]{2,80})\*\*/g)) {
          if (!esisteNelMenu(m[1], nomi)) problemi.push(`INVENTATO "${m[1]}"`);
        }
        for (const s of sugg) if (RIVOLTO_AL_CLIENTE.test(normalizza(s))) problemi.push(`SUGGERIMENTO "${s}"`);

        risposte++;
        errori += problemi.length;
        const esito = problemi.length ? '✗' : '✓';
        console.log(`[${lang}] ${esito} ${secondi}s  «${domanda}»`);
        console.log(`      ${testo.replace(/\n+/g, ' / ').slice(0, 220)}`);
        if (sugg.length) console.log(`      pulsanti: ${sugg.join(' | ')}`);
        for (const p of problemi) console.log(`      !! ${p}`);
      }
    }
  }
  console.log(`\n${risposte} risposte controllate, ${errori} problemi.`);
  process.exit(errori ? 1 : 0);
}

main().catch(e => { console.error('Errore:', e.message); process.exit(2); });
