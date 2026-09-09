// Entry point per Vercel (serverless).
// Ricrea l'app Express di dist/index.js SENZA app.listen() e senza lo scheduler cron,
// che su Vercel non puo' funzionare.
//
// IMPORTANTE: i require() devono avere il percorso scritto per esteso (letterale).
// Vercel analizza staticamente il codice per decidere quali file caricare online:
// con require(variabile) non capisce quali file servono e non li carica -> errore 503.
require('dotenv/config');

// Su Vercel il filesystem e' in sola lettura tranne /tmp: l'upload dei loghi
// crea una cartella con process.cwd(), quindi spostiamo la cwd su /tmp.
try { process.chdir('/tmp'); } catch (e) {}

const express = require('express');
const cors = require('cors');

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app') || origin.endsWith('.onrender.com') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api/whatsapp', express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

function mount(routePath, loader) {
  try {
    const mod = loader();
    app.use(routePath, mod.default || mod);
  } catch (err) {
    console.error('Rotta non caricata: ' + routePath + ' -> ' + err.stack);
    app.use(routePath, (_req, res) =>
      res.status(503).json({ error: 'Rotta non caricata', path: routePath, detail: String(err && err.message) })
    );
  }
}

mount('/api/menu',      () => require('../dist/routes/menu'));
mount('/api/chat',      () => require('../dist/routes/chat'));
mount('/api/orders',    () => require('../dist/routes/orders'));
mount('/api/inventory', () => require('../dist/routes/inventory'));
mount('/api/dashboard', () => require('../dist/routes/dashboard'));
mount('/api/auth',      () => require('../dist/routes/auth'));
mount('/api/alerts',    () => require('../dist/routes/alerts'));
mount('/api/forecast',  () => require('../dist/routes/forecast'));
mount('/api/pos',       () => require('../dist/routes/pos'));
mount('/api/admin',     () => require('../dist/routes/superadmin'));
mount('/api/billing',   () => require('../dist/routes/billing'));
mount('/api/upload',    () => require('../dist/routes/upload'));
mount('/api/whatsapp',  () => require('../dist/routes/whatsapp'));

module.exports = app;
