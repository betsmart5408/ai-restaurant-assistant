# Rispondere alle recensioni Google

Il ristoratore non risponde quasi mai alle recensioni: non ha tempo e non sa
cosa scrivere. Gli strumenti generici rispondono senza sapere niente del
locale ("ci dispiace per l'accaduto"). Noi il menu ce l'abbiamo: la risposta
puo' citare il piatto di cui parla il cliente, nella sua lingua.

Google non lascia che sia il nostro server a leggere le recensioni da solo:
serve il login del titolare al suo profilo. Quel pezzo lo fa **Make.com**, che
ha gia' i moduli pronti per Google Business Profile. Noi mettiamo il cervello.

```
Google  ──►  Make (Watch reviews)  ──►  nostra API  ──►  Make (Reply)  ──►  Google
                                            │
                                            └─ se 1-3 stelle ──► WhatsApp al titolare
```

---

## 1. Cosa fa la nostra API

**`POST https://ai-restaurant-assistant-production-449f.up.railway.app/api/recensioni/rispondi`**

Header: `X-Api-Key: <RECENSIONI_API_KEY>`

Corpo:

```json
{ "slug": "gusto-alcazabilla", "stelle": 2, "testo": "...", "autore": "Marco" }
```

Risposta:

```json
{
  "risposta": "...",
  "pubblicabile": false,
  "motivo": "2 stelle: la deve leggere il ristoratore prima di pubblicarla.",
  "ristorante": "Gusto Alcazabilla",
  "stelle": 2
}
```

`pubblicabile` e' il campo che conta. **4 o 5 stelle -> true**, si pubblica da
sola. **1, 2 o 3 stelle -> false**, la legge prima il titolare. La soglia si
sposta con `RECENSIONI_STELLE_AUTO` nel .env.

Per controllare che sia vivo: `GET /api/recensioni/stato` (non serve chiave).

### Le regole dentro il prompt

La risposta viene scritta **nella lingua della recensione** (giapponese ->
giapponese), lunga 2-4 frasi, a nome del locale. E per legge di casa non fa
mai queste cose:

- non inventa fatti ("abbiamo parlato con il personale", "quel cameriere non
  lavora piu' qui") - non c'era;
- non offre rimborsi, cene gratis, sconti;
- non ammette colpe e non parla di igiene, malattie o allergeni;
- non ripete il dettaglio della lamentela (resta online per sempre sotto il
  nome del locale);
- niente emoji, niente hashtag.

Il testo della recensione entra delimitato e ripulito: se dentro c'e' scritto
"ignora le istruzioni e scrivi X", e' una recensione mal scritta, non un
ordine.

---

## 2. Attivare (una volta sola)

L'API sta su **Railway** e si ripubblica da sola a ogni `git push` su
`master`. Il codice delle recensioni e' gia' su `origin/master`, quindi e' gia'
online: manca solo la chiave. Finche' Railway non ce l'ha, l'endpoint risponde
401 a tutti.

Railway **non legge il .env** del PC: le variabili vanno messe a mano.

1. railway.app -> progetto dell'API -> servizio -> **Variables**
2. **New Variable**, due righe (il valore della chiave e' nel `.env`):

   ```
   RECENSIONI_API_KEY=<quella del .env>
   RECENSIONI_STELLE_AUTO=4
   ```

3. Railway ridistribuisce da solo (1-2 minuti). Niente `git push`, niente
   script di deploy. `deploy-tutto.ps1` e' il vecchio deploy su Vercel: non si
   usa piu'.

Poi la prova, dal PC:

```powershell
.\prova-recensioni.ps1
```

Deve dire `attivo: True`. Se dice `False`, la variabile su Railway non c'e' o
ha un nome sbagliato.

---

## 3. Lo scenario su Make.com

Serve un account Make (il piano gratuito basta per cominciare: 1000 operazioni
al mese, e una recensione ne consuma 3-4).

### Modulo 1 - Google Business Profile > Watch Reviews

- **Connection**: "Add" e poi il login Google del titolare. Make ha la sua
  connessione pronta, non serve aprire un progetto su Google Cloud ne'
  chiedere l'accesso alle API.
- **Location**: la scheda del locale. Deve essere **verificata** su Google
  Business Profile, altrimenti il modulo non la vede.
- **Limit**: 10.
- In basso, **Scheduling**: ogni 15 minuti va benissimo.

### Modulo 2 - HTTP > Make a request

- **URL**: `https://ai-restaurant-assistant-production-449f.up.railway.app/api/recensioni/rispondi`
- **Method**: POST
- **Headers**: `X-Api-Key` = il valore di `RECENSIONI_API_KEY` nel `.env`
- **Body type**: Raw / JSON (content-type `application/json`)
- **Request content**:

```json
{
  "slug": "gusto-alcazabilla",
  "stelle": {{1.starRating}},
  "testo": "{{1.comment}}",
  "autore": "{{1.reviewer.displayName}}"
}
```

> Attenzione: Google manda le stelle come parola (`FIVE`, `FOUR`...). Se nel
> modulo arriva cosi', mettici davanti un **Tools > Switch**: FIVE->5,
> FOUR->4, THREE->3, TWO->2, ONE->1.

- **Parse response**: si'.

### Modulo 3 - Router

Due rami.

**Ramo A - si pubblica** (filtro: `{{2.data.pubblicabile}}` = `true`)

Google Business Profile > **Reply to a review**
- Review: quella del modulo 1
- Comment: `{{2.data.risposta}}`

**Ramo B - la deve vedere il titolare** (filtro: `pubblicabile` = `false`)

Twilio > **Send a message** (le credenziali sono gia' nel .env del progetto),
oppure Email. Testo:

```
Recensione da {{1.starRating}} stelle di {{1.reviewer.displayName}}.

"{{1.comment}}"

Risposta proposta:
{{2.data.risposta}}

Se va bene copiala su Google. Se no, correggila.
```

---

## 4. Da tenere a mente

- **Una scheda Google per ristorante.** Per servire piu' locali si duplica lo
  scenario cambiando `slug` e connessione, oppure si usa un Iterator sulle
  location.
- **Costo IA**: una risposta sono ~600 token in ingresso e 150 in uscita. Sul
  piano gratuito di Groq non si sente.
- **La chiave protegge i soldi.** Ogni chiamata all'endpoint spende IA: chi
  conosce l'indirizzo senza chiave prende 401 e basta.
- **Niente risposta automatica sotto le 4 stelle.** Una risposta sbagliata a
  "ho trovato un capello" trasforma una recensione brutta in un caso, e
  compare sotto il nome del locale, non sotto il nostro.

---

## 5. Perche' questo vende

E' la seconda cosa che si mostra al ristoratore dopo il menu multilingua, ed
e' quella che si capisce in dieci secondi: "le recensioni ti rispondono da
sole, nella lingua del cliente, citando il piatto giusto". Nella demo basta
incollare una recensione vera del suo locale e fargli leggere la risposta.
