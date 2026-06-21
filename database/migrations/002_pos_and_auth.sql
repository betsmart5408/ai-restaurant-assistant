-- ── POS config per ristorante ───────────────────────────────
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS pos_config JSONB DEFAULT NULL;

-- ── Payment ID dal POS sugli ordini ─────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_payment_id TEXT DEFAULT NULL;

-- ── Superadmin user (inserito manualmente) ──────────────────
-- Per creare il superadmin eseguire:
-- INSERT INTO users (restaurant_id, email, password_hash, role)
-- VALUES (<any-restaurant-id>, 'admin@restaurant.ai', <bcrypt-hash>, 'superadmin');

-- ── Indice per ricerca POS su location_id ────────────────────
CREATE INDEX IF NOT EXISTS idx_restaurants_pos_config
  ON restaurants USING gin(pos_config);

CREATE INDEX IF NOT EXISTS idx_orders_pos_payment
  ON orders(pos_payment_id) WHERE pos_payment_id IS NOT NULL;
