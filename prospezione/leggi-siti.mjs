/**
 * Lettore di siti — passo 2 della macchina delle demo.
 *
 *   node prospezione/leggi-siti.mjs
 *   node prospezione/leggi-siti.mjs --limite 30      (prova su pochi)
 *   node prospezione/leggi-siti.mjs --riprova        (ritenta quelli falliti)
 *
 * Prende i ristoranti CON SITO trovati al passo 1, visita ogni sito e cerca:
 *   - l'indirizzo email di contatto
 *   - la pagina del menu (o il PDF del menu)
 *   - quante lingue ha gia' il sito   <- e' il filtro che conta davvero
 *   - su che piattaforma e' costruito (Wix, WordPress, Squarespace...)
 *
 * Il candidato ideale e' un ristorante in zona turistica che HA un sito ma
 * lo ha in UNA SOLA lingua: e' esattamente il problema che risolviamo.
 *
 * Regole di educazione, non negoziabili: legge robots.txt e lo rispetta,
 * si presenta con un User-Agent onesto, non fa piu' di 3 richieste per sito,
 * aspetta fra una e l'altra. Non stiamo rubando dati: stiamo leggendo pagine
 * pubbliche come farebbe una persona, solo in modo ordinato.
 *
 * Non serve npm install: usa solo Node 18 o superiore.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const QUI = dirname(fileURLToPath(import.meta.url));
const CARTELLA_DATI = process.env.CARTELLA_DATI ? join(QUI, process.env.CARTELLA_DATI) : join(QUI, 'dati');

const UA = 'AI-Restaurant-Assistant/1.0 (valutazione siti ristoranti; nessuna raccolta automatica di dati personali)';
const IN_PARALLELO = 4;          // quanti siti alla volta
const ATTESA_FRA_PAGINE_MS = 1200;
const TIMEOUT_MS = 20000;
const MAX_PAGINE_PER_SITO = 3;

const argomenti = process.argv.slice(2);
const valore = (nome) => { const i = argomenti.indexOf(nome); return i !== -1 ? argomenti[i + 1] : null; };
const limite = Number(valore('--limite')) || null;
const riprova = argomenti.includes('--riprova');
const rifai = argomenti.includes('--rifai');   // rilegge anche quelli gia' letti
const citta = (valore('--citta') || 'sydney').toLowerCase();

const attesa = (ms) => new Promise(r => setTimeout(r, ms));

// ── Reti di sicurezza per l'estrazione ──────────────────────────────────────

// Scarta gli indirizzi che sembrano email ma non lo sono (nomi di immagini
// tipo logo@2x.png) e quelli dei fornitori di servizi, non del ristorante.
// Fornitori di font, strumenti e piattaforme: le loro email finiscono dentro
// i fogli di stile e le licenze, e NON sono del ristorante.
const EMAIL_DA_SCARTARE = new RegExp([
  '@(2x|3x)\\b',
  '@(sentry|sentry\\.io|wixpress|wix|squarespace|shopify|godaddy|weebly|webflow|duda)\\b',
  '@(astigmatic|fontawesome|fontfabric|typekit|adobe|myfonts|fontspring|linotype|monotype|fontbureau|dafont)\\b',
  '@(example|placeholder|domain|yourdomain|yoursite|email|test|sentry|localhost)\\b',
  '@(sentry|wordpress|automattic|jetpack|gravatar|cloudflare|google|gmail\\.example)\\b',
  '\\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf|eot)$',
].join('|'), 'i');
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// ── Come si riconosce la pagina del menu ────────────────────────────────────
//
// Cercare una parola-chiave "da qualche parte" nel link non basta: e' cosi'
// che abbiamo preso /event/bottomless-brunch, /up-to-50-off-dining e
// /venues/alpha-dining/about-us. Diamo invece un punteggio, e vince il
// migliore: il testo del link conta piu' dell'indirizzo, un segmento intero
// del percorso conta piu' di una parola incastrata dentro un'altra, e le
// pagine che sicuramente NON sono menu perdono punti.

// Testo del link, corrispondenza esatta: il segnale piu' forte che esista.
// In spagnolo (e catalano) la pagina del menu si chiama quasi sempre "carta",
// non "menu": senza queste parole i siti spagnoli restavano quasi tutti fuori.
const TESTO_MENU = /^(menu|menus|our menu|the menu|food|foods|our food|food menu|drinks?|drinks menu|wine list|wines?|cocktails?|beer list|dine in|dining|a la carte|à la carte|breakfast|lunch|dinner|brunch|takeaway|take away|order online|menu & drinks|carta|la carta|nuestra carta|ver carta|carta de platos|menú|menú del día|menu del dia|platos|nuestros platos|especialidades|nuestra carta de platos)$/i;

// Solo bevande. Per un ristorante il menu del CIBO viene prima: la carta dei
// vini non serve a dimostrare che traduciamo un menu. Restano validi per i
// bar, ma perdono contro un menu di cibo quando c'e'.
const SOLO_BEVANDE = /^(drink|drinks|drinks-menu|wine|wines|wine-list|winelist|wines-by-the-glass|cocktail|cocktails|cocktail-list|beer|beers|beer-list|spirits|whisky|whiskey|sake|coffee|bar-menu|bar-list|beverages)$/i;

// Segmento intero del percorso: /menu/ si', /alpha-dining/ no.
const SEGMENTO_MENU = /^(menu|menus|our-menu|the-menu|food|foods|our-food|food-menu|drink|drinks|drinks-menu|wine|wines|wine-list|winelist|cocktail|cocktails|beer|beers|bar-menu|dine-in|a-la-carte|alacarte|carte|carta|speisekarte|breakfast|lunch|dinner|brunch|takeaway|take-away|eat|eats|kitchen|menu-food|menu-drinks|degustazione|tasting-menu)$/i;

// Segmenti che escludono la pagina: qui il menu non c'e' mai.
const SEGMENTO_NO = /^(event|events|whats-on|blog|news|about|about-us|our-story|story|contact|contact-us|find-us|gift|gifts|gift-cards|vouchers|book|booking|bookings|reserve|reservations|careers|jobs|press|media|gallery|photos|privacy|terms|policy|cart|checkout|account|login|shop|merch|faq|functions|venue-hire|private-dining|catering)$/i;

// Indirizzi da promozione: "up to 50% off dining" non e' un menu.
const PROMO = /(\d+[-_ ]?%?[-_ ]?off|discount|deal|deals|promo|promotion|special-offer|voucher|bottomless|happy-hour|set-menu-deal)/i;

function segmenti(u) {
  try { return new URL(u).pathname.split('/').filter(Boolean).map(x => x.toLowerCase()); }
  catch { return []; }
}

function punteggioMenu(link, urlHome) {
  const testo = (link.testo || '').replace(/\s+/g, ' ').trim();
  const segs = segmenti(link.url);
  const ultimo = segs[segs.length - 1] ?? '';
  let punti = 0;

  if (TESTO_MENU.test(testo)) punti += 10;
  else if (/\bmenu\b/i.test(testo)) punti += 5;

  if (segs.some(x => SEGMENTO_MENU.test(x))) punti += 6;
  else if (/menu/i.test(link.url)) punti += 2;

  // Solo bevande: vale meno, cosi' perde contro il menu del cibo.
  const soloBevande = segs.some(x => SOLO_BEVANDE.test(x)) ||
    /^(drinks?|wine list|wines?|cocktails?|beer list|bar menu|beverages)$/i.test(testo);
  if (soloBevande) punti -= 7;

  if (segs.some(x => SEGMENTO_NO.test(x))) punti -= 12;
  if (PROMO.test(link.url) || PROMO.test(testo)) punti -= 10;

  // Una pagina "about-us" dentro un percorso che contiene "dining" resta
  // una pagina about: comanda l'ultimo segmento.
  if (SEGMENTO_NO.test(ultimo)) punti -= 6;

  // Un menu su un altro dominio (gruppo, piattaforma) e' meno affidabile.
  try {
    if (new URL(link.url).hostname.replace(/^www\./, '') !== new URL(urlHome).hostname.replace(/^www\./, '')) punti -= 6;
  } catch { /* indirizzo strano: nessuna penalita' */ }

  return punti;
}

function migliorLink(link, urlHome, filtro = () => true) {
  let migliore = null, massimo = 0;
  for (const l of link) {
    if (!filtro(l)) continue;
    const p = punteggioMenu(l, urlHome);
    if (p > massimo) { massimo = p; migliore = l; }
  }
  return migliore;
}

// Parole che indicano una pagina menu, nelle lingue che si incontrano davvero
const RE_MENU = /\b(menu|menus|carte|speisekarte|carta|men[uù]|food|foods|drinks|dine|dine-in|dining|eat|eats|our-food|our-menu|lunch|dinner|brunch|breakfast|a-la-carte|alacarte|takeaway|take-away|order|order-online|kitchen|cucina|pizze|pizza-menu|specials|bill-of-fare|drink|wine|wines|winelist|wine-list|cocktail|cocktails|beer|beers|bar-menu|tasting|degustazione|list)\b/i;
const RE_CONTATTI = /\b(contact|contatti|about|kontakt|reservation|book|find-us|location)\b/i;

// Indizi che il sito e' gia' multilingua: se ci sono, NON e' un nostro candidato
const CODICI_LINGUA = ['en','it','es','fr','de','pt','zh','zh-cn','zh-tw','ja','ko','ru','ar','th','vi','id','hi','nl','sv','el','tr','he','pl'];

function estraiEmail(html, dominioSito) {
  const daMailto = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) daMailto.add(decodeURIComponent(m[1]));

  // Cloudflare offusca i mailto contro gli spambot: l'indirizzo vero e' in
  // data-cfemail, esadecimale, con il primo byte usato come chiave.
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    try {
      const b = m[1].match(/../g).map(h => parseInt(h, 16));
      daMailto.add(b.slice(1).map(x => String.fromCharCode(x ^ b[0])).join(''));
    } catch { /* offuscamento non standard: pazienza */ }
  }

  // I dati strutturati (application/ld+json) sono la fonte MIGLIORE: sono
  // messi apposta dal sito per essere letti, e contengono il contatto vero.
  // Li teniamo. Buttiamo via solo il resto degli script e i fogli di stile,
  // dove stanno licenze di font e chiavi di servizi.
  const datiStrutturati = [...html.matchAll(
    /<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map(m => m[1]).join(' ');

  const soloTesto = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const daTesto = new Set();
  for (const m of (soloTesto + ' ' + datiStrutturati).matchAll(RE_EMAIL)) daTesto.add(m[0]);

  const pulisci = (insieme) => [...insieme]
    .map(e => e.trim().toLowerCase().replace(/[.,;:]$/, ''))
    .filter(e => e.includes('@') && !EMAIL_DA_SCARTARE.test(e) && e.length < 80);

  // Ordine di fiducia: prima quelle sullo stesso dominio del sito (sono
  // sicuramente del ristorante), poi i link mailto, poi il resto.
  const stessoDominio = (e) => dominioSito && e.split('@')[1]?.endsWith(dominioSito);
  const tutte = [...new Set([...pulisci(daMailto), ...pulisci(daTesto)])];
  return tutte.sort((a, b) => (stessoDominio(b) ? 1 : 0) - (stessoDominio(a) ? 1 : 0));
}

function estraiLingue(html, url) {
  const lingue = new Set();
  const attr = html.match(/<html[^>]+lang=["']([a-zA-Z-]{2,5})["']/i);
  if (attr) lingue.add(attr[1].toLowerCase().split('-')[0]);
  for (const m of html.matchAll(/hreflang=["']([a-zA-Z-]{2,5})["']/gi)) {
    const l = m[1].toLowerCase().split('-')[0];
    if (l !== 'x') lingue.add(l);
  }
  // link tipo /en/ /it/ /?lang=ja — il selettore di lingua fatto a mano
  for (const m of html.matchAll(/href=["'][^"']*?[/?](?:lang=|locale=|)([a-z]{2})(?:[/"'?&]|$)/gi)) {
    const l = m[1].toLowerCase();
    if (CODICI_LINGUA.includes(l)) lingue.add(l);
  }
  // strumenti di traduzione: se c'e' uno di questi il sito e' gia' coperto
  const strumento = /translate\.google|google[_-]?translate|goog-te|weglot|gtranslate|transposh|polylang|wpml|linguise|localize(js|\.js)|conveythis|translatepress/i.test(html);
  return { lingue: [...lingue].sort(), strumentoTraduzione: strumento };
}

function estraiPiattaforma(html) {
  const p = [
    [/wix\.com|wixstatic|_wixCssImports/i, 'Wix'],
    [/squarespace/i, 'Squarespace'],
    [/wp-content|wp-includes/i, 'WordPress'],
    [/cdn\.shopify|shopify/i, 'Shopify'],
    [/squareup|square-web|weebly/i, 'Square/Weebly'],
    [/godaddy|websitebuilder/i, 'GoDaddy'],
    [/webflow/i, 'Webflow'],
    [/duda|dudamobile/i, 'Duda'],
  ];
  for (const [re, nome] of p) if (re.test(html)) return nome;
  return '';
}

function assolutizza(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

function estraiLink(html, base) {
  const link = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const url = assolutizza(m[1], base);
    if (!url || !/^https?:/i.test(url)) continue;
    const testo = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    link.push({ url, testo });
  }
  return link;
}

// ── Robots.txt ──────────────────────────────────────────────────────────────

const robotsInCache = new Map();

async function permesso(url) {
  let origine;
  try { origine = new URL(url).origin; } catch { return false; }
  if (!robotsInCache.has(origine)) {
    let regole = [];
    try {
      const r = await fetch(origine + '/robots.txt', {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000), redirect: 'follow',
      });
      if (r.ok) {
        const testo = await r.text();
        let valePerNoi = false;
        for (const riga of testo.split('\n')) {
          const pulita = riga.split('#')[0].trim();
          const [chiave, ...resto] = pulita.split(':');
          const val = resto.join(':').trim();
          if (/^user-agent$/i.test(chiave)) valePerNoi = (val === '*');
          else if (valePerNoi && /^disallow$/i.test(chiave) && val) regole.push(val);
        }
      }
    } catch { /* niente robots.txt = tutto permesso */ }
    robotsInCache.set(origine, regole);
  }
  const percorso = new URL(url).pathname;
  return !robotsInCache.get(origine).some(r => r !== '/' ? percorso.startsWith(r) : percorso === '/' || percorso.startsWith('/'));
}

// ── Lettura di un sito ──────────────────────────────────────────────────────

async function scarica(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  const tipo = r.headers.get('content-type') ?? '';
  if (!r.ok || !/text\/html/i.test(tipo)) return { stato: r.status, html: '', url: r.url };
  const html = (await r.text()).slice(0, 400000);
  return { stato: r.status, html, url: r.url };
}

async function leggiSito(ristorante) {
  const esito = {
    nome: ristorante.nome, sito: ristorante.sito, zona_etichetta: ristorante.zona_etichetta,
    cucina: ristorante.cucina, indirizzo: ristorante.indirizzo, telefono: ristorante.telefono,
    osm_id: ristorante.osm_id,
    stato: '', email: '', email_da_controllare: '', tutte_le_email: '', lingue: '', n_lingue: 0, strumento_traduzione: '',
    pagina_menu: '', punteggio_menu: 0, menu_in_home: '', menu_dietro_ingresso: '', menu_pdf: '', piattaforma: '', candidato: '', motivo: '',
    letto_il: new Date().toISOString().slice(0, 10),
  };

  // Se OpenStreetMap aveva gia' un'email la teniamo da subito: cosi' non la
  // perdiamo nemmeno quando il sito e' irraggiungibile.
  if (ristorante.email) {
    esito.email = String(ristorante.email).toLowerCase().trim();
    esito.tutte_le_email = esito.email;
  }

  let url = ristorante.sito;
  if (!/^https?:/i.test(url)) url = 'https://' + url.replace(/^\/+/, '');

  if (!(await permesso(url))) {
    esito.stato = 'robots.txt lo vieta';
    esito.motivo = 'Il sito chiede di non essere letto da programmi: lo rispettiamo.';
    return esito;
  }

  // Molti "irraggiungibile" sono solo l'indirizzo scritto senza www, o con
  // http al posto di https. Proviamo le varianti prima di arrenderci.
  const varianti = [url];
  try {
    const u = new URL(url);
    const porta = u.port ? ':' + u.port : '';
    const senzaWww = u.hostname.replace(/^www\./, '');
    const altroWww = (u.hostname.startsWith('www.') ? senzaWww : 'www.' + senzaWww) + porta;
    const stessoHost = u.hostname + porta;
    const prot = u.protocol;   // niente https forzato: si perdeva la porta e il sito locale

    varianti.push(`${prot}//${altroWww}${u.pathname}`);
    // OpenStreetMap spesso ha un indirizzo profondo che nel frattempo e'
    // sparito (era il 404 piu' comune): la radice del sito di solito c'e'.
    if (u.pathname && u.pathname !== '/') {
      varianti.push(`${prot}//${stessoHost}/`);
      varianti.push(`${prot}//${altroWww}/`);
    }
    if (prot === 'https:') varianti.push(`http://${stessoHost}${u.pathname}`);
  } catch { /* indirizzo malformato: restano le varianti che abbiamo */ }

  let home = null, ultimoErrore = '', dettaglioErrore = '';
  for (const tentativo of [...new Set(varianti)]) {
    try {
      const r = await scarica(tentativo);
      if (r.html) { home = r; break; }
      ultimoErrore = `risposta ${r.stato}`;
    } catch (e) {
      ultimoErrore = /timeout|abort/i.test(e.message) ? 'troppo lento' : 'irraggiungibile';
      dettaglioErrore = (e.cause?.code || e.message || '').slice(0, 40);
      // EAI_AGAIN e' un intoppo temporaneo del DNS, non un sito morto:
      // vale la pena ridare la stessa richiesta dopo qualche secondo.
      if (dettaglioErrore.includes('EAI_AGAIN')) {
        await attesa(5000);
        try {
          const r2 = await scarica(tentativo);
          if (r2.html) { home = r2; break; }
        } catch { /* confermato: e' davvero irraggiungibile */ }
      }
    }
    await attesa(800);
  }
  if (!home) {
    esito.stato = ultimoErrore || 'irraggiungibile';
    esito.motivo = 'Non raggiungibile nemmeno con www o http' +
      (dettaglioErrore ? ` (${dettaglioErrore})` : '') + '. Da controllare a mano.';
    return esito;
  }
  esito.stato = 'ok';
  esito.piattaforma = estraiPiattaforma(home.html);
  const { lingue, strumentoTraduzione } = estraiLingue(home.html, home.url);
  esito.lingue = lingue.join(' ');
  esito.n_lingue = lingue.length;
  esito.strumento_traduzione = strumentoTraduzione ? 'si' : '';

  const dominioSito = (() => { try { return new URL(home.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  let email = estraiEmail(home.html, dominioSito);
  const link = estraiLink(home.html, home.url);
  const stessoDominio = (u) => { try { return new URL(u).hostname.replace(/^www\./,'') === new URL(home.url).hostname.replace(/^www\./,''); } catch { return false; } };

  const pdfMenu = migliorLink(link, home.url, l => /\.pdf($|\?)/i.test(l.url));
  if (pdfMenu) esito.menu_pdf = pdfMenu.url;

  const paginaMenu = migliorLink(link, home.url, l => stessoDominio(l.url) && !/\.pdf/i.test(l.url));
  if (paginaMenu) { esito.pagina_menu = paginaMenu.url; esito.punteggio_menu = punteggioMenu(paginaMenu, home.url); }

  // Pagina d'ingresso ("ENTER", "Enter site"): il sito vero sta dietro. Se
  // la home ha pochi link e nessun menu, seguiamo il varco e riguardiamo.
  if (!esito.pagina_menu && !esito.menu_pdf && link.length <= 12) {
    const varco = link.find(l => stessoDominio(l.url) &&
      (/^\s*(enter|entra|enter site|skip intro|continue)\s*$/i.test(l.testo) || /\/(enter|home|main)\/?$/i.test(l.url)))
      ?? link.find(l => stessoDominio(l.url) && l.url !== home.url && !/contact|about|privacy|cart|book/i.test(l.url));
    if (varco && await permesso(varco.url)) {
      await attesa(ATTESA_FRA_PAGINE_MS);
      try {
        const dietro = await scarica(varco.url);
        if (dietro.html) {
          const linkDietro = estraiLink(dietro.html, dietro.url);
          const m = migliorLink(linkDietro, dietro.url, l => stessoDominio(l.url) && !/\.pdf/i.test(l.url));
          if (m) { esito.pagina_menu = m.url; esito.menu_dietro_ingresso = 'si'; esito.punteggio_menu = punteggioMenu(m, dietro.url); }
          const pdf = migliorLink(linkDietro, dietro.url, l => /\.pdf($|\?)/i.test(l.url));
          if (pdf && !esito.menu_pdf) esito.menu_pdf = pdf.url;
          if (email.length === 0) email = estraiEmail(dietro.html, dominioSito);
        }
      } catch { /* il varco non ha portato da nessuna parte */ }
    }
  }

  // Moltissimi siti di ristoranti sono a pagina unica: il menu E' la home.
  // Il segnale piu' affidabile sono i prezzi. Se ne contiamo abbastanza,
  // la pagina del menu e' quella su cui siamo gia'.
  if (!esito.pagina_menu) {
    const testoHome = home.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
    const prezzi = testoHome.match(/(?:\$|AUD\s?|€|£)\s?\d{1,3}(?:[.,]\d{2})?\b/g) ?? [];
    if (prezzi.length >= 8) {
      esito.pagina_menu = home.url;
      esito.menu_in_home = 'si';
    }
  }

  // Se l'email non e' in home, la cerchiamo nella pagina contatti e nel menu.
  const daVisitare = [];
  if (email.length === 0) {
    const contatti = link.find(l => stessoDominio(l.url) && (RE_CONTATTI.test(l.testo) || RE_CONTATTI.test(l.url)));
    if (contatti) daVisitare.push(contatti.url);
  }
  if (paginaMenu && daVisitare.length < MAX_PAGINE_PER_SITO - 1) daVisitare.push(paginaMenu.url);

  for (const altra of daVisitare.slice(0, MAX_PAGINE_PER_SITO - 1)) {
    await attesa(ATTESA_FRA_PAGINE_MS);
    if (!(await permesso(altra))) continue;
    try {
      const pag = await scarica(altra);
      if (!pag.html) continue;
      if (email.length === 0) email = estraiEmail(pag.html, dominioSito);
      if (!esito.menu_pdf) {
        const p = estraiLink(pag.html, pag.url).find(l => /\.pdf($|\?)/i.test(l.url) && (RE_MENU.test(l.testo) || RE_MENU.test(l.url)));
        if (p) esito.menu_pdf = p.url;
      }
    } catch { /* pagina secondaria: se non va, pazienza */ }
  }

  // OSM a volte ha gia' l'email: se il sito non ne da', usiamo quella.
  if (email.length === 0 && ristorante.email) email = [String(ristorante.email).toLowerCase()];

  if (email.length) {
    esito.email = email[0];
    esito.tutte_le_email = email.slice(0, 4).join(' ');
    // Se l'email non e' sul dominio del sito puo' essere di un'agenzia, di un
    // gruppo o di una piattaforma di prenotazioni: da guardare prima di usarla.
    const dom = esito.email.split('@')[1] ?? '';
    if (dominioSito && !dom.endsWith(dominioSito) && !dominioSito.endsWith(dom)) {
      esito.email_da_controllare = 'si';
    }
  }

  // ── Giudizio ──
  const motivi = [];
  if (esito.n_lingue > 1 || strumentoTraduzione) motivi.push('ha gia\' piu\' lingue');
  if (!esito.email) motivi.push('nessuna email trovata');
  if (!esito.pagina_menu && !esito.menu_pdf) motivi.push('nessun menu trovato sul sito');

  if (motivi.length === 0) {
    esito.candidato = 'SI';
    esito.motivo = 'Sito in una lingua sola, menu online, email disponibile.';
  } else if (motivi.includes('ha gia\' piu\' lingue')) {
    esito.candidato = 'no';
    esito.motivo = 'Gia\' multilingua: non ha il problema che risolviamo.';
  } else {
    esito.candidato = 'forse';
    esito.motivo = 'Manca qualcosa: ' + motivi.join(', ') + '.';
  }
  return esito;
}

// ── Salvataggio ─────────────────────────────────────────────────────────────

const COLONNE = ['candidato','nome','email','email_da_controllare','n_lingue','lingue','pagina_menu','punteggio_menu','menu_in_home','menu_dietro_ingresso','menu_pdf','cucina','indirizzo',
  'telefono','zona_etichetta','piattaforma','strumento_traduzione','stato','motivo','sito','tutte_le_email','osm_id','letto_il'];

function perCsv(v) { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }

function salva(righe) {
  const ordine = { 'SI': 0, 'forse': 1, 'no': 2, '': 3 };
  righe.sort((a,b) => (ordine[a.candidato] ?? 3) - (ordine[b.candidato] ?? 3) || a.nome.localeCompare(b.nome));
  writeFileSync(join(CARTELLA_DATI, `siti-${citta}.json`), JSON.stringify(righe, null, 2), 'utf-8');
  const csv = [COLONNE.join(';'), ...righe.map(r => COLONNE.map(c => perCsv(r[c])).join(';'))].join('\r\n');
  writeFileSync(join(CARTELLA_DATI, `siti-${citta}.csv`), '﻿' + csv, 'utf-8');
}

// ── Programma principale ────────────────────────────────────────────────────

async function main() {
  if (!existsSync(CARTELLA_DATI)) mkdirSync(CARTELLA_DATI, { recursive: true });
  const percorsoIn = join(CARTELLA_DATI, `ristoranti-${citta}.json`);
  if (!existsSync(percorsoIn)) {
    console.error(`Manca ${percorsoIn}. Lancia prima .\\trova-ristoranti.ps1`);
    process.exit(1);
  }

  const tutti = JSON.parse(readFileSync(percorsoIn, 'utf-8'));
  const conSito = tutti.filter(r => r.sito);

  const percorsoOut = join(CARTELLA_DATI, `siti-${citta}.json`);
  const fatti = existsSync(percorsoOut) ? JSON.parse(readFileSync(percorsoOut, 'utf-8')) : [];
  const perOsmId = new Map(fatti.map(r => [r.osm_id, r]));

  let daFare = conSito.filter(r => {
    const g = perOsmId.get(r.osm_id);
    if (!g) return true;
    if (rifai) return true;               // con --rifai si rilegge tutto
    return riprova && g.stato !== 'ok';   // con --riprova solo i falliti
  });
  if (limite) daFare = daFare.slice(0, limite);

  if (daFare.length === 0) {
    console.log('Niente da leggere: tutti i siti sono gia' + "' stati visitati.");
    console.log('Usa --riprova per ritentare quelli che erano falliti.');
    return;
  }

  console.log(`${conSito.length} ristoranti con sito. Ne leggo ${daFare.length}.`);
  console.log(`(${IN_PARALLELO} alla volta, con pause: mettici circa ${Math.ceil(daFare.length * 4 / IN_PARALLELO / 60)} minuti)\n`);

  let fatto = 0;
  const coda = [...daFare];

  async function operaio() {
    while (coda.length) {
      const r = coda.shift();
      let esito;
      try { esito = await leggiSito(r); }
      catch (e) { esito = { nome: r.nome, sito: r.sito, osm_id: r.osm_id, stato: 'errore: ' + e.message, candidato: '', motivo: '' }; }
      perOsmId.set(r.osm_id, esito);
      fatto++;
      const segno = esito.candidato === 'SI' ? '✔' : esito.candidato === 'forse' ? '·' : ' ';
      console.log(`[${String(fatto).padStart(4)}/${daFare.length}] ${segno} ${(esito.nome ?? '').slice(0,34).padEnd(34)} ${esito.stato.padEnd(16)} ${esito.email || ''}`);
      if (fatto % 20 === 0) salva([...perOsmId.values()]);
      await attesa(ATTESA_FRA_PAGINE_MS);
    }
  }

  await Promise.all(Array.from({ length: IN_PARALLELO }, operaio));
  const righe = [...perOsmId.values()];
  salva(righe);

  const si = righe.filter(r => r.candidato === 'SI').length;
  const forse = righe.filter(r => r.candidato === 'forse').length;
  const no = righe.filter(r => r.candidato === 'no').length;
  const conEmail = righe.filter(r => r.email).length;
  const rotti = righe.filter(r => r.stato && r.stato !== 'ok').length;

  console.log('\n─────────────────────────────────────────');
  console.log(`Siti letti:                 ${righe.length}`);
  console.log(`  CANDIDATI (una lingua,`);
  console.log(`  menu ed email):           ${si}   <- da qui partiamo`);
  console.log(`  forse (manca qualcosa):   ${forse}`);
  console.log(`  gia' multilingua:         ${no}`);
  console.log(`  con email trovata:        ${conEmail}`);
  console.log(`  siti non raggiungibili:   ${rotti}`);
  console.log(`\nSalvato in ${CARTELLA_DATI}${'/'}siti-${citta}.csv (ordinato: i candidati sono in cima)`);
}

main().catch(e => { console.error('\nErrore:', e.message); process.exit(1); });
