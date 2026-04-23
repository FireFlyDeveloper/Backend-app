-- Migration 3: Inventory Base

CREATE TABLE IF NOT EXISTS items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type   TEXT NOT NULL CHECK (item_type IN ('trackable', 'quantifiable')),
  name        TEXT NOT NULL,
  category    TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_items_type ON items(item_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_status ON items(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_category ON items(category) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_items_updated_at
BEFORE UPDATE ON items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
