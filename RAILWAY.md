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
   APP_URL=https://app.lingofork.com
   DASHBOARD_URL=https://app.lingofork.com
   ALLOWED_ORIGINS=https://menu.lingofork.com,https://app.lingofork.com,https://cucina.lingofork.com
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

## Le 3 interfacce ora stanno su Cloudflare Pages (non piu' Vercel)

Vercel Hobby limita a 100 deploy/giorno e lo sforavamo di continuo. Le 3
interfacce (siti statici) sono passate a **Cloudflare Pages**, deploy diretti
illimitati e gratis. Vedi `CLOUDFLARE.md`.

Dominio: **lingofork.com** (registrato su Cloudflare). Domini di produzione:

```
https://menu.lingofork.com    -> progetto Pages gustobolsa-chat      (clienti / QR menu)
https://app.lingofork.com     -> progetto Pages gustobolsa-dashboard (dashboard + /attiva)
https://cucina.lingofork.com  -> progetto Pages gustobolsa-cucina    (da collegare quando serve)
```

Gli URL `gustobolsa-*.pages.dev` restano validi come fallback. Per ripubblicare
le interfacce: `.\deploy-cloudflare.ps1`. `deploy-tutto.ps1` (Vercel) e i
progetti Vercel `restaurant-*` non servono piu'.

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
