-- ============================================================
-- SaaS Billing — subscription + logo + superadmin
-- ============================================================

-- Aggiungi campi billing ai ristoranti
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS plan            TEXT DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_ends_at   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS stripe_customer_id  TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_email   TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monthly_price   DECIMAL(8,2) DEFAULT 49.00;

-- Superadmin user separato (non legato a un ristorante)
CREATE TABLE IF NOT EXISTS superadmins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella pagamenti (storico)
CREATE TABLE IF NOT EXISTS billing_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id   UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  stripe_event_id TEXT UNIQUE,
  event_type      TEXT NOT NULL,
  amount          DECIMAL(8,2),
  currency        TEXT DEFAULT 'eur',
  status          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indici
CREATE INDEX IF NOT EXISTS idx_restaurants_stripe ON restaurants(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_restaurant ON billing_events(restaurant_id);
