# API su Railway (stabile — sostituisce Vercel)

L'API su Vercel serverless continua a perdere l'alias (`restaurant-api-psi`
va in 404 da sola). Railway tiene un server sempre acceso: niente alias che
salta, deploy automatico a ogni push, e lo scheduler degli alert torna a
funzionare.

## Passi (una volta sola, ~15 minuti)

1. Vai su **railway.app** → accedi con GitHub.
2. **New Project → Deploy from GitHub repo** → scegli `betsmart5408/ai-restaurant-assistant`.
3. Railway legge `railway.json` alla radice: build = `npm install && npm run build --workspace=packages/api`, start = `npm run start --workspace=packages/api`. Non toccare nulla.
4. **Variables** → incolla queste (i valori li prendi dal tuo file `.env`):

   ```
   DATABASE_URL=...
   JWT_SECRET=...
   GROQ_API_KEY=...
   ANTHROPIC_API_KEY=...
   APP_URL=https://restaurant-dashboard-two-hazel.vercel.app
   DASHBOARD_URL=https://restaurant-dashboard-two-hazel.vercel.app
   ALLOWED_ORIGINS=https://restaurant-chat-gustobolsa.vercel.app,https://restaurant-dashboard-two-hazel.vercel.app,https://restaurant-cucina-gustobolsa.vercel.app
   SALES_WHATSAPP=14155238886
   SALES_TRIAL_DAYS=7
   SALES_PRICE=€49/mese
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_WHATSAPP_FROM=+14155238886
   MYMEMORY_EMAIL=pippobasile1977@gmail.com
   NODE_ENV=production
   ```
   (Stripe: aggiungi `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` quando configuri i pagamenti.)

   NB: NON impostare `PORT` — lo mette Railway da solo.

5. **Settings → Networking → Generate Domain**: ottieni un URL tipo
   `https://ai-restaurant-assistant-production.up.railway.app`.
6. Aspetta il deploy (2-3 min), poi apri `<url>/health` → deve dare
   `{"status":"ok"}`.

## Sposta le interfacce sul nuovo URL

Nel progetto, in `apps/*/​.env.production` metti il nuovo URL:
```
VITE_API_URL=https://<il-tuo>.up.railway.app
```
per `customer-chat`, `owner-dashboard`, `kitchen-display`. Poi ripubblica le
3 interfacce (`.\deploy-tutto.ps1` — l'API su Vercel puoi ignorarla / cancellare
il progetto `restaurant-api`).

## Webhook che puntano all'API
- **Twilio WhatsApp** "When a message comes in" → `https://<url>.up.railway.app/api/whatsapp/inbound`
- **Stripe** webhook → `https://<url>.up.railway.app/api/billing/webhook`

## Aggiornamenti futuri
Ogni `git push` su `master` → Railway ricompila e ridistribuisce da solo.
Costo: ~$5/mese (piano Hobby), a consumo.

## Se il build fallisce su `@duckdb/node-api`
È una dipendenza pesante nel `package.json` di root e potrebbe non servire
all'API. In quel caso spostala da `dependencies` a `optionalDependencies`
nel `package.json` di root e ripushare.
