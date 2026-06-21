-- ============================================================
-- AI Restaurant Assistant — Schema iniziale
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Ristoranti ──────────────────────────────────────────────
CREATE TABLE restaurants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  languages     TEXT[] DEFAULT ARRAY['it','en'],
  currency      TEXT DEFAULT 'EUR',
  timezone      TEXT DEFAULT 'Europe/Rome',
  logo_url      TEXT,
  whatsapp      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Utenti (ristoratori) ─────────────────────────────────────
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT DEFAULT 'owner',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Ingredienti ─────────────────────────────────────────────
CREATE TABLE ingredients (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  unit           TEXT NOT NULL,      -- g, kg, ml, l, pz
  current_qty    DECIMAL(10,3) DEFAULT 0,
  min_threshold  DECIMAL(10,3) DEFAULT 0,
  cost_per_unit  DECIMAL(8,4) DEFAULT 0,  -- costo per unità (g/ml/pz)
  expiry_date    DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(restaurant_id, name)
);

-- ── Piatti ──────────────────────────────────────────────────
CREATE TABLE dishes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT DEFAULT '',
  price          DECIMAL(8,2) NOT NULL,
  cost           DECIMAL(8,2) DEFAULT 0,
  category       TEXT NOT NULL,  -- antipasto, primo, secondo, dessert, bevanda, altro
  allergens      TEXT[] DEFAULT ARRAY[]::TEXT[],
  image_url      TEXT,
  available      BOOLEAN DEFAULT TRUE,
  prep_time_min  INT DEFAULT 10,
  sort_order     INT DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Ricette (piatto → ingredienti) ──────────────────────────
CREATE TABLE recipe_ingredients (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dish_id        UUID REFERENCES dishes(id) ON DELETE CASCADE,
  ingredient_id  UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty            DECIMAL(10,3) NOT NULL,
  unit           TEXT NOT NULL
);

-- ── Tavoli ──────────────────────────────────────────────────
CREATE TABLE tables (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  number         INT NOT NULL,
  qr_code        TEXT,  -- URL del QR
  active         BOOLEAN DEFAULT TRUE,
  UNIQUE(restaurant_id, number)
);

-- ── Ordini ──────────────────────────────────────────────────
CREATE TABLE orders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id       UUID REFERENCES tables(id),
  session_id     TEXT NOT NULL,  -- chat session
  status         TEXT DEFAULT 'PENDING',
  total          DECIMAL(8,2) DEFAULT 0,
  language       TEXT DEFAULT 'it',
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Righe ordine ────────────────────────────────────────────
CREATE TABLE order_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id       UUID REFERENCES orders(id) ON DELETE CASCADE,
  dish_id        UUID REFERENCES dishes(id),
  dish_name      TEXT NOT NULL,
  qty            INT NOT NULL DEFAULT 1,
  unit_price     DECIMAL(8,2) NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sessioni chat ────────────────────────────────────────────
CREATE TABLE chat_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id       UUID REFERENCES tables(id),
  language       TEXT DEFAULT 'it',
  messages       JSONB DEFAULT '[]',
  order_id       UUID REFERENCES orders(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Movimenti magazzino ──────────────────────────────────────
CREATE TABLE inventory_movements (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  ingredient_id  UUID REFERENCES ingredients(id),
  qty_delta      DECIMAL(10,3) NOT NULL,  -- negativo = consumo, positivo = carico
  reason         TEXT,  -- 'sale', 'restock', 'waste', 'manual'
  order_id       UUID REFERENCES orders(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indici performance ───────────────────────────────────────
CREATE INDEX idx_orders_restaurant_status ON orders(restaurant_id, status);
CREATE INDEX idx_orders_created_at ON orders(restaurant_id, created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_inventory_movements_ingredient ON inventory_movements(ingredient_id, created_at DESC);
CREATE INDEX idx_chat_sessions_table ON chat_sessions(table_id, created_at DESC);

-- ── Trigger: aggiorna updated_at ────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
