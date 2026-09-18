# Costruire le demo — istruzioni complete

Incolla questo documento all'inizio di una chat nuova. Contiene tutto quello
che serve: il progetto, dove stanno le cose, cosa fare e cosa non fare.

---

## 1. Il progetto in due minuti

**AI Restaurant Assistant** è un menu multilingua con QR code per ristoranti in
zone turistiche. Il cliente inquadra il QR, sceglie la sua lingua e legge il
menu tradotto. C'è anche un assistente che consiglia i piatti, ma il valore
principale è il menu multilingua.

**Il modello commerciale:** invece di vendere a freddo, costruiamo **prima** la
demo del ristorante — col suo nome, il suo menu vero, il suo aspetto — e poi
gli mandiamo il link già pronto. Non "potresti avere questo", ma "guarda,
questo è il tuo".

**A che punto siamo.** La macchina che trova i ristoranti e legge i loro menu è
finita e funziona. A Sydney: 15.712 locali trovati, 2.503 siti visitati, **691
candidati** (sito in una lingua sola, con menu online e con email). Di questi,
i menu già estratti stanno in `prospezione\menu\`.

**Quello che manca, ed è il tuo compito: trasformare quei menu in demo vere,
online, con un link da mandare.**

---

## 2. Dove sono le cose

Tutto sta in `C:\Users\pippo\Desktop\AI Restaurant Assistant`.

| Cosa | Dove |
|---|---|
| Menu estratti, uno per ristorante | `prospezione\menu\<slug>.json` |
| I 100 candidati migliori | `sydney-candidati-100.xlsx` |
| Elenco completo dei siti letti | `prospezione\dati\siti-sydney.json` |
| Traduzioni fatte a mano | `database\traduzioni\<slug>.<lingua>.json` |
| Chiavi e collegamenti | `.env` (DATABASE_URL, GROQ_API_KEY, FOURSQUARE_TOKEN) |

**Ambiente.** Database PostgreSQL su Neon. Siti pubblicati su Vercel (team
`gustobolsa`), quattro progetti: `restaurant-api`, `restaurant-chat`,
`restaurant-cucina`, `restaurant-dashboard`.

**Indirizzi:**
- Menu cliente: `https://restaurant-chat-gustobolsa.vercel.app/?restaurant=<slug>`
- Dashboard: `https://restaurant-dashboard-gustobolsa.vercel.app`
- API: `https://restaurant-api-gustobolsa.vercel.app`

**REGOLA IMPORTANTE SULL'AMBIENTE.** Il container in cloud e la macchina
virtuale del ponte **non hanno accesso** a Neon, Vercel, Groq né ai siti dei
ristoranti. Tutto quello che tocca la rete deve girare **sul PC Windows di
Giuseppe**, tramite gli script PowerShell nella cartella. Puoi scrivere e
modificare i file, ma i comandi li lancia lui.

---

## 3. Com'è fatto un menu estratto

`prospezione\menu\al-aseel.json`:

```json
{
  "slug": "al-aseel",
  "nome": "Al Aseel",
  "email": "hello@alaseel.com.au",
  "sito": "https://www.alaseel.com.au/",
  "pagina_menu": "https://alaseel.com.au/al-aseel-menu-lebanese-restaurant-sydney/",
  "citta": "Sydney",
  "paese": "Australia",
  "cucina": "lebanese",
  "indirizzo": "189 Missenden Road, Newtown, 2042",
  "telefono": "+61 2 9550 3194",
  "zona": "Newtown",
  "piatti": [
    { "nome": "Hommos", "descrizione": "chickpeas, tahini, lemon", "prezzo": 14, "categoria": "Cold Mezza" }
  ]
}
```

Un file con `"esito": "non riuscito"` è un tentativo fallito: ignoralo.

**Prima di usare un menu, controllalo.** Serve almeno **8 piatti** e la
maggioranza con un prezzo. Un menu con 3 piatti e nessun prezzo fa più danno
che bene: il ristoratore apre il link, vede una cosa vuota, e l'hai perso per
sempre. Meglio saltarlo.

---

## 4. Cosa devi costruire

Uno script `prospezione\crea-demo.mjs` (Node, senza dipendenze oltre a `pg`
che è già installato) più un `crea-demo.ps1` che lo lancia. Per ogni menu:

### 4.1 Crea il ristorante nel database

Tabella `restaurants`. Colonne utili:

- `name` — il nome vero del locale
- `slug` — **usa il prefisso `demo-`**: `demo-al-aseel`. Serve a distinguerli
  dai clienti veri e a poterli cancellare in blocco.
- `city` = `Sydney`, `country` = `Australia`
- `latitude`, `longitude` — dal file dei siti, servono all'assistente per il meteo
- `cuisine_type` — dal campo `cucina`
- `about` — una riga sul locale, scritta da te, **senza inventare niente** che
  non sia nel loro sito
- `base_lang` = `en` (a Sydney i menu sono in inglese)
- `languages` — vedi elenco lingue più sotto
- `currency` = `AUD`
- `primary_color`, `background_color`, `font_family` — vedi §4.4
- `billing_email` — l'email trovata
- `plan` = `trial`, `subscription_status` = `trialing`

### 4.2 Inserisci i piatti

Tabella `dishes`: `restaurant_id`, `name`, `description`, `price`, `category`,
`available = true`, `sort_order` (l'ordine del file, così il menu non si
mescola).

**Copia i nomi e i prezzi esattamente come stanno nel file.** Non correggere,
non abbellire, non arrotondare. Se un prezzo è sbagliato nella demo, il
ristoratore se ne accorge subito ed è finita.

### 4.3 Crea le righe della tabella `tables`

L'assistente non parte senza. Inserisci almeno `number = 1`, meglio da 1 a 3.

### 4.4 Scegli i colori

Il sito calcola il tema dalla luminosità dello sfondo, quindi funziona sia
chiaro che scuro. Scegli in base alla cucina — un giapponese non ha gli stessi
colori di una pizzeria. Se il sito del ristorante ha un colore dominante
riconoscibile, usa quello: la demo sembrerà fatta apposta per lui, ed è
esattamente l'effetto che vogliamo.

---

## 5. Le traduzioni — falle a mano, non con l'IA

Questo è il punto che Giuseppe ha chiesto esplicitamente, ed è già stato fatto
una volta con successo per Gusto Alcazabilla: 179 piatti × 9 lingue = **1.611
voci scritte a mano**.

**Perché a mano e non con Groq:** il piano gratuito ha un tetto di token al
minuto che si tocca continuamente, i modelli vengono ritirati senza preavviso,
e su un menu una traduzione mediocre si vede. Per dieci-quindici ristoranti
scriverle è più veloce che far funzionare l'automatismo, e viene meglio.

**Il limite è la scala:** dieci-quindici ristoranti per sessione. Cento no.

### 5.1 Il formato dei file — leggi bene, è controintuitivo

Un file per lingua: `database\traduzioni\demo-al-aseel.it.json`

```json
{
  "Hommos": "ceci, tahina, limone, olio extravergine",
  "Baba Ghanouj": "melanzane affumicate, tahina, labneh, olio d'oliva"
}
```

**La chiave è il nome del piatto ORIGINALE, non tradotto.
Il valore è la DESCRIZIONE tradotta.**

I nomi dei piatti **non si traducono mai**. "Hommos" resta "Hommos" in tutte le
lingue, come "Margherita" resta "Margherita". Si traduce solo la descrizione:
cioè quello che il turista ha bisogno di capire per scegliere.

La chiave deve corrispondere **esattamente** al nome nel database (il confronto
ignora maiuscole e spazi ai bordi, niente di più). Se non corrisponde, quella
voce viene saltata e lo script te lo dice alla fine.

### 5.2 Le lingue per Sydney

Diverse da Málaga: lì servivano russo e arabo, qui servono le lingue asiatiche.
In ordine di utilità per i turisti in Australia:

| Codice | Lingua | Perché |
|---|---|---|
| `zh` | Cinese semplificato | Il gruppo di turisti più numeroso |
| `ja` | Giapponese | Molti visitatori, poco inglese |
| `ko` | Coreano | In forte crescita |
| `id` | Indonesiano | Vicini, tantissimi visitatori |
| `hi` | Hindi | Grande comunità indiana e molti turisti |
| `de` | Tedesco | Turismo di lunga permanenza |
| `fr` | Francese | Idem |
| `es` | Spagnolo | Sudamericani e spagnoli |
| `it` | Italiano | Comunità italiana storica, e per Giuseppe |

Il file `.en.json` **non serve**: l'inglese è la lingua base, le descrizioni
originali sono già nel campo `description` dei piatti.

### 5.3 Come si caricano

```
.\carica-traduzioni.ps1 -Slug demo-al-aseel
```

Vengono salvate con `source = 'manual'`, quindi il traduttore automatico non le
sovrascriverà mai. Lo script stampa quante ne ha caricate per lingua e ti
elenca i nomi che non ha trovato — **controlla sempre quell'elenco**, è lì che
si vedono gli errori di battitura nelle chiavi.

### 5.4 Come si traduce un menu, in pratica

Traduci **per il turista che deve scegliere**, non alla lettera:

- Se la descrizione originale manca, scrivine una breve e vera basata sul nome
  e sul tipo di cucina. Cinque-dieci parole. **Non inventare ingredienti che
  non sai**: "Hommos" → "purè di ceci con tahina" va bene, aggiungere "con
  aglio e cumino" no, se non sta scritto.
- Mantieni i nomi propri, i nomi dei vini, le denominazioni.
- Per il cinese e il giapponese usa i termini che si usano davvero nei menu di
  quei paesi, non la traduzione parola per parola.
- Se un piatto è particolare per quella cucina, una parola di contesto aiuta:
  "Labneh" → "yogurt colato tipo formaggio spalmabile".

---

## 6. Regole di sicurezza — non negoziabili

**Allergeni.** Non scrivere mai, in nessuna lingua, che un piatto è "senza
glutine", "senza lattosio", "adatto ai vegani" o sicuro per un'allergia, a meno
che non sia scritto sul menu originale. Non sei in cucina, non conosci le
ricette né le contaminazioni. Questa regola c'è già nel prompt dell'assistente
perché era stato scoperto a dire a un celiaco che la Caesar Salad è senza
glutine — che ha i crostini. Vale identica per le traduzioni.

**Non inventare piatti né prezzi.** Se il menu estratto ha buchi, lascia i
buchi o salta il ristorante. Una demo con un piatto inventato è peggio di
nessuna demo.

**Non pubblicare niente a nome del ristorante fuori dai nostri indirizzi.** La
demo sta su `restaurant-chat-gustobolsa.vercel.app`, che è chiaramente nostro.
Non registrare domini col loro nome, non creare pagine social, non mandare
email al posto loro.

---

## 7. Trappole già scoperte, per non ripeterle

- **I DECIMAL di PostgreSQL arrivano come stringhe.** `monthly_price` letto dal
  database è `"49.00"`, non `49`. Serve `Number(...)` prima di `.toFixed()`,
  altrimenti la pagina va in bianco. È già successo due volte.
- **`esbuild` non controlla i tipi.** Per l'API usa sempre
  `npx tsc --skipLibCheck --noEmit` prima di dire che compila.
- **PowerShell:** niente parentesi angolari nei comandi (`<` è un operatore
  riservato), e le password vanno fra apici singoli.
- **Groq:** i nomi dei modelli cambiano, non scriverne mai uno fisso nel codice
  — chiedi la lista disponibile e scegli. Sul 429 aspetta il tempo che indica
  lui, non riprovare subito.
- **La chiave Groq nel `.env` è vecchia e viene rifiutata.** Quella buona è nel
  database, colonna `restaurants.groq_api_key`.
- **Non fidarti di quello che risponde un modello.** Ricontrolla sempre: prezzi
  negativi, doppioni, campi vuoti, JSON malformato. Succede regolarmente.

---

## 8. Da dove cominciare

1. Guarda `prospezione\menu\` e scegli i menu con almeno 8 piatti e i prezzi.
2. Costruisci `crea-demo.mjs` e provalo su **uno solo**, controllando il
   risultato nel browser prima di andare avanti.
3. Traduci quel primo menu nelle 9 lingue e caricalo.
4. Apri il link e verifica: cambio lingua, prezzi giusti, colori sensati.
5. Solo quando quello è perfetto, fai gli altri.

Il primo link vero vale più di dieci a metà.

---

## Categorie del menu (aggiunto 4 settembre)

Le categorie NON sono piu' una lista fissa. L'app mostra quelle che trova nei
piatti, cosi' come le scrive il ristorante ("Hot Mezza", "To Share", "STARTERS").

Per tradurle si usa la tabella `category_translations`:

    restaurant_id | category | lang | name | source

- `source = 'manual'` -> scritta a mano, il traduttore automatico non la tocca
- `source = 'auto'`   -> generata da `prospezione/traduci-categorie.mjs`

Dopo aver creato una demo nuova:

    .\demo-completa.ps1 -Slug <slug>     crea + carica il menu
    .\traduci-demo.ps1 -Slug <slug>      traduce i piatti
    .\traduci-categorie.ps1 -Slug <slug> traduce le intestazioni di sezione

Le categorie interne di Gusto (antipasti, pizze, primi, secondi, dolci,
cocktails, spirits, birre, vini, soft_drinks) hanno gia' le etichette dentro
l'app in 10 lingue: per quelle non serve tradurre niente.

## Valuta

Il prezzo usa il campo `currency` del ristorante, non l'euro fisso:
AUD -> A$, EUR -> euro, USD -> $, GBP -> sterlina. Le demo di Sydney vanno
create con `currency: 'AUD'` (crea-demo.mjs lo fa gia').
