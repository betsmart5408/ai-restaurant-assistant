# AI Restaurant Assistant — Product Design Document

## Vision
Piattaforma SaaS per ristoranti turistici che combina AI conversazionale, gestione ordini e intelligenza di magazzino per aumentare i ricavi e ridurre gli sprechi.

---

## Target
- Piccoli e medi ristoranti in zone turistiche (Italia, Spagna, Austria, Germania)
- Proprietario non tecnico, vuole semplicità e risultati concreti

## KPI di successo
| Metrica | Target |
|---|---|
| Aumento scontrino medio | +15–25% |
| Riduzione sprechi alimentari | -20–30% |
| Riduzione errori ordine | -90% |
| Tempo onboarding | < 2 ore |

---

## Architettura di sistema

```
CUSTOMER LAYER
  QR Menu → AI Chat (multilingua) → Upselling → Ordine

CORE AI ENGINE
  Claude AI (LLM) + Menu Engine + Upsell Engine + Translation

OPERATIONS LAYER
  Kitchen Display + Order Manager + Inventory + Anti-Spreco

ANALYTICS LAYER
  Dashboard + Forecast AI + Report automatici + Alert
```

---

## Moduli funzionali

### 1. QR Menu AI

**Flusso utente:**
1. Cliente scansiona QR code sul tavolo
2. Si apre web app (no download) con chat AI
3. L'AI rileva la lingua del browser / chiede preferenza
4. Mostra menu interattivo con foto, prezzi, descrizioni
5. Risponde a domande su allergeni, ingredienti, porzioni

**Tecnologia:**
- Frontend: React PWA (Progressive Web App)
- Backend: Node.js + Claude claude-sonnet-4-6 API
- QR: uno per tavolo, contiene `?table=12`
- Multilingua: IT / EN / DE / ES / FR (estendibile)

**Prompt system per Claude:**
```
Sei l'assistente del Ristorante [NOME]. 
Menu attuale: [JSON_MENU].
Lingua: [LINGUA_RILEVATA].
Tavolo: [N_TAVOLO].
Regole upselling: [REGOLE].
Allergeni registrati: [LISTA].
```

---

### 2. AI Order System

**Flusso ordine:**
1. Cliente dice "Vorrei una lasagna e una birra"
2. AI confirma ordine con riepilogo
3. Cliente approva
4. Ordine → Kitchen Display (KDS) in tempo reale
5. Dashboard ristoratore si aggiorna

**Stati ordine:**
`PENDING → CONFIRMED → IN_KITCHEN → READY → SERVED → PAID`

**Struttura dati ordine:**
```json
{
  "order_id": "uuid",
  "table": 12,
  "timestamp": "ISO8601",
  "items": [
    { "dish_id": "lasagna", "qty": 1, "note": "senza glutine", "price": 14.50 }
  ],
  "status": "IN_KITCHEN",
  "total": 14.50
}
```

---

### 3. Upselling AI

**Logica di raccomandazione:**

| Situazione | Suggerimento AI |
|---|---|
| Solo piatto principale | "Vuoi aggiungere un antipasto?" |
| Nessuna bevanda | "Posso consigliarti un vino locale?" |
| Piatto da bambini ordinato | "Per i piccoli, abbiamo anche il gelato artigianale" |
| Stock alto di un prodotto | "Oggi consigliamo la specialità del giorno: [X]" |
| Nessun dessert | A fine pasto: "Possiamo portare il menù dei dolci?" |

**Regole configurabili dal ristoratore:**
- Abbinamenti fissi (es: pizza → birra artigianale)
- Piatto del giorno (priorità alta)
- Prodotti in scadenza (promozione automatica)
- Margine minimo per promuovere

**Target incremento:** +15-25% scontrino medio

---

### 4. Ingredient-Based System (Ricette)

**Struttura ricetta:**
```json
{
  "dish_id": "lasagna_classica",
  "name": "Lasagna Classica",
  "price": 14.50,
  "cost": 3.80,
  "margin_pct": 73.8,
  "ingredients": [
    { "ingredient_id": "mozzarella", "qty": 200, "unit": "g" },
    { "ingredient_id": "carne_macinata", "qty": 150, "unit": "g" },
    { "ingredient_id": "pomodoro_pelato", "qty": 100, "unit": "g" },
    { "ingredient_id": "sfoglia_pasta", "qty": 120, "unit": "g" }
  ],
  "allergens": ["glutine", "lattosio", "uova"],
  "prep_time_min": 15
}
```

**Scalatura automatica:**
- Ogni vendita di 1 lasagna → sistema scala automaticamente gli ingredienti
- Nessun intervento manuale del ristoratore

---

### 5. Inventory Management

**Funzionalità:**
- Stock iniziale inserito dal ristoratore (kg, litri, unità)
- Scalatura automatica ad ogni ordine venduto
- Alert quando ingrediente < soglia minima
- Vista magazzino per categoria

**Alert automatici:**
```
🔴 CRITICO: Mozzarella < 500g (esaurimento previsto: 2 ore)
🟡 ATTENZIONE: Carne macinata < 1kg (riordino consigliato)
🟢 OK: Pomodori pelati 5kg (scorta per 3 giorni)
```

**Stima consumo:**
- Sistema calcola media giornaliera degli ultimi 7/30 giorni
- Prevede esaurimento scorte
- Suggerisce quantità da ordinare al fornitore

---

### 6. Waste Prevention (Anti-Spreco)

**Logica:**
1. Sistema conosce scadenze ingredienti (inserite dal ristoratore)
2. 48h prima della scadenza → attiva promozione automatica
3. L'AI propone piatti che usano quell'ingrediente in modo prioritario
4. Ristoratore può approvare o modificare la promo

**Esempio automatico:**
```
Domani scade: Ricotta (2kg)
→ AI suggerisce: "Oggi proponiamo Cannoli Siciliani a 5€ invece di 7€"
→ In chat clienti: "🌟 Specialità del giorno: Cannoli Siciliani"
```

---

### 7. Dashboard Ristoratore

**Vista principale (mobile-first):**
- Ricavo oggi / questa settimana / questo mese
- Ordini attivi in tempo reale
- Top 5 piatti più venduti
- Alert magazzino
- Scontrino medio (con confronto settimana scorsa)

**Viste secondarie:**
- Analisi margini per piatto
- Andamento vendite per fascia oraria
- Previsione scorte necessarie
- Report settimanale (PDF + WhatsApp)

**KPI principali:**
```
Scontrino medio: €28.40 (+12% vs settimana scorsa)
Coperti oggi: 47
Ricavo oggi: €1.334,80
Ingredienti in scadenza: 2 (azione richiesta)
```

---

## Stack tecnologico

### Backend
- **Runtime:** Node.js + TypeScript
- **API:** Express.js o Fastify
- **Database:** PostgreSQL (dati strutturati) + Redis (cache/sessioni)
- **AI:** Anthropic Claude claude-sonnet-4-6 (via API)
- **Auth:** JWT + refresh token

### Frontend
- **Customer chat:** React + Tailwind (PWA, no download)
- **Dashboard owner:** React + Recharts (grafici)
- **Kitchen Display:** React full-screen (tablet cucina)

### Infrastructure
- **Hosting:** Railway.app o Render (semplice, economico)
- **Storage:** Cloudflare R2 (foto menu)
- **Notify:** Twilio (WhatsApp) + SendGrid (email)

---

## Modello di prezzo (SaaS)

| Piano | Prezzo/mese | Coperti/mese | Features |
|---|---|---|---|
| **Starter** | €49 | fino a 500 | QR Menu + Ordini + KDS |
| **Growth** | €99 | fino a 2.000 | + Inventory + Upselling AI |
| **Pro** | €179 | illimitati | + Forecast + Report + WhatsApp |

**ROI per il ristoratore:**
- Piano Growth €99/mese
- +15% scontrino su 50 coperti/giorno × €25 medio = +€187/giorno
- Payback: < 1 giorno di lavoro aggiuntivo

---

## Roadmap

### Fase 1 — MVP (mesi 1-3)
- [ ] QR Menu + Chat AI multilingua (IT/EN/DE)
- [ ] Sistema ordini → Kitchen Display
- [ ] Gestione menu (CRUD ristoratore)
- [ ] Dashboard base (vendite oggi)

### Fase 2 — Core Product (mesi 4-6)
- [ ] Upselling AI con regole configurabili
- [ ] Ingredient-based inventory
- [ ] Scalatura automatica scorte
- [ ] Alert magazzino via WhatsApp

### Fase 3 — Intelligence (mesi 7-9)
- [ ] Forecast AI scorte
- [ ] Anti-spreco automatico
- [ ] Report settimanali automatici
- [ ] Analisi margini per piatto

### Fase 4 — Growth (mesi 10-12)
- [ ] Integrazione POS (Square, SumUp)
- [ ] Multi-ristorante (catene)
- [ ] API pubblica per integrazioni
- [ ] App mobile nativa (iOS/Android)

---

## Rischi e mitigazioni

| Rischio | Probabilità | Mitigazione |
|---|---|---|
| Adozione lenta (non tecnici) | Alta | Onboarding video guidato < 30 min |
| Qualità AI in lingue diverse | Media | Test estensivi DE/ES, fallback traduzione |
| Connettività ristorante | Media | PWA offline-first per cucina |
| Concorrenza POS esistenti | Alta | Differenziazione su AI upselling |
| Costi API Claude | Bassa | ~€0.003/ordine, incluso nel prezzo |

---

## Struttura cartelle progetto

```
ai-restaurant-assistant/
├── apps/
│   ├── customer-chat/        # React PWA cliente
│   ├── kitchen-display/      # React tablet cucina  
│   └── owner-dashboard/      # React dashboard ristoratore
├── packages/
│   ├── api/                  # Node.js backend
│   ├── ai-engine/            # Claude integration + prompts
│   ├── inventory/            # Logica magazzino + ricette
│   └── shared/               # Types, utils condivisi
├── database/
│   ├── migrations/           # SQL migrations
│   └── seeds/                # Dati demo
└── docs/
    └── PRODUCT_DESIGN.md     # Questo file
```
