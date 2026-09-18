# Controllo completo — AI Restaurant Assistant
Data: 2 settembre 2026

Ho provato l'assistente dal vivo, letto tutto il codice del server e delle tre
app, e controllato il database. Qui sotto trovi cosa ho trovato e cosa ho gia'
sistemato. **Le correzioni sono scritte nei file ma non sono ancora online:
devi lanciare `deploy-tutto.ps1`.**

---

## 1. GRAVE — l'assistente inventava informazioni sulle allergie

**Cosa succedeva.** Ho scritto all'assistente in inglese fingendomi celiaco.
Ha risposto:

> "You can safely enjoy **Caprese**, **Carpaccio**, **Caesar Salad** (no
> croutons)... all prepared without gluten-containing ingredients."

Poi ho controllato il database:

```
piatti totali:                       179
piatti con allergeni registrati:       0
```

Nessuno di quei piatti ha allergeni registrati. L'assistente li stava
deducendo dal nome. La Caesar Salad ha crostini e salsa Worcestershire: e'
una risposta che puo' mandare qualcuno in ospedale, e la responsabilita'
ricadrebbe sul ristorante e su di noi.

**Cosa ho fatto.**

- Regola di sicurezza non negoziabile nel prompt: l'assistente non puo' MAI
  dichiarare che un piatto e' sicuro, "senza glutine" o "senza lattosio".
  Non e' in cucina, non conosce le ricette ne' le contaminazioni.
- Puo' riportare **solo** gli allergeni scritti nel menu, mai dedurli.
- Quando qualcuno dichiara un'allergia: ringrazia, dice che avvisa il
  personale, e manda **sempre** al cameriere.
- Se il ristorante non ha ancora registrato gli allergeni (come ora),
  l'assistente lo dice apertamente invece di improvvisare.
- Gli allergeni, quando ci sono, ora vengono passati al modello.

**Da fare tu:** nella dashboard, riempi il campo allergeni dei piatti. Finche'
e' vuoto l'assistente non puo' aiutare chi ha allergie, puo' solo mandarlo
al cameriere. Per un cliente che vendiamo, questo va spiegato in fase di
consegna.

---

## 2. GRAVE — chiunque poteva modificare il menu di qualunque ristorante

Queste rotte del server erano **completamente aperte**, senza password:

| Rotta | Cosa permetteva a un estraneo |
|---|---|
| `POST /api/menu/:slug/dishes` | aggiungere piatti a qualunque ristorante |
| `PATCH /api/menu/:slug/dishes/:id` | cambiare nome e **prezzo** dei piatti |
| `PUT /api/dashboard/:id/settings` | **sovrascrivere la chiave API Groq** |
| `PUT /api/dashboard/:id/appearance` | cambiare colori e carattere |
| `PUT /api/dashboard/:id/locale` | cambiare citta' e paese |
| `GET /api/dashboard/:id/today` `weekly` `margins` | leggere incassi e margini |

Bastava conoscere lo slug del ristorante (che e' nel QR code) per mettere a
zero i prezzi o leggere i margini.

In piu', le rotte che *avevano* la password non controllavano **di quale**
ristorante fossi proprietario: un cliente nostro poteva cancellare i piatti
di un altro cliente nostro.

**Cosa ho fatto.**

- Aggiunto il controllo password su tutte le rotte di scrittura elencate.
- Creato un controllo nuovo (`requireOwnSlug`) che verifica che il ristorante
  nell'indirizzo sia davvero il tuo, e l'ho messo su tutte le rotte dei piatti
  e delle traduzioni. Il superadmin passa comunque.
- Protetta anche `cerca-citta`, che chiamava un servizio esterno senza limiti.

La dashboard mandava gia' la password in tutte le chiamate, quindi non cambia
niente per te: continuera' a funzionare identica. Cambia solo per chi prova
a entrare da fuori.

---

## 3. MEDIO — risposte lente e spesa senza tetto

Nei miei test: **1,9 secondi** per una domanda in italiano all'inizio della
conversazione, **38,7 secondi** per una piu' avanti nella stessa chat.

Il motivo: a ogni messaggio veniva rimandata al modello **tutta** la
conversazione dall'inizio. Piu' si parla, piu' e' lenta e piu' costa. E non
c'era nessun limite: un messaggio da 50.000 caratteri, o mille messaggi di
fila, li pagava il ristoratore.

**Cosa ho fatto.**

- Al modello vanno solo gli **ultimi 12 scambi**, non l'intera chat.
- Messaggio singolo: massimo 600 caratteri.
- Massimo 60 messaggi per sessione; oltre, l'assistente invita gentilmente a
  chiedere al cameriere.
- Aggiunto il tracciamento di quale modello Groq ha risposto, cosi' se resta
  lenta sappiamo se e' colpa del modello.

---

## 4. DA SISTEMARE — l'app "cucina" non e' pronta per i clienti

`apps/kitchen-display` viene ancora messa online da `deploy-tutto.ps1`
(progetto `restaurant-cucina`), ma:

- ha **un solo ristorante scritto dentro il codice**
  (`11111111-1111-1111-1111-111111111111`), quindi mostrerebbe gli ordini
  sbagliati a chiunque la aprisse;
- le rotte `/api/orders/*` che usa sono senza password.

E' un residuo del progetto originale, quando c'era un solo ristorante e i
tavoli. Ora che abbiamo tolto i tavoli e gli ordini non serve.

**Consiglio:** toglierla da `deploy-tutto.ps1` finche' non la rifacciamo. Non
l'ho fatto da solo perche' e' una tua decisione di prodotto: dimmi e lo tolgo
in un minuto.

---

## Cose che ho controllato e vanno bene

- Il caricamento del logo prende il ristorante dalla password, non dal
  messaggio: non si puo' cambiare il logo a un altro.
- La chiave API viene mostrata mascherata nella dashboard.
- `JWT_SECRET` e' impostato davvero (48 caratteri), non e' rimasto quello di
  prova.
- Le password sono salvate cifrate (bcrypt), mai in chiaro.
- Il superadmin ha un controllo di ruolo separato e funzionante.
- L'assistente in italiano: risponde in italiano, senza blocchi `<think>`,
  cita piatti veri del menu, propone 3 suggerimenti. Buono.
- Le traduzioni: 1.611 voci nel database, il ripiego funziona quando manca
  una traduzione.
- Colori, caratteri e anteprima smartphone: funzionano.

---

## Cosa devi fare adesso

1. Apri PowerShell nella cartella del progetto e lancia:

   ```
   Set-ExecutionPolicy -Scope Process Bypass -Force
   .\deploy-tutto.ps1
   ```

2. Scrivimi quando e' finito: rifaccio i test dal vivo, soprattutto la
   domanda sulle allergie in inglese, e ti confermo che risponde bene.

3. Quando hai un attimo, compila gli allergeni dei piatti dalla dashboard.
