-- =============================================================================
-- Dragonfly Core: Document + Hybrid Inventory Platform
-- Complete Database Schema
-- =============================================================================
-- This is a self-contained schema file that creates the entire database from
-- scratch. It is idempotent where possible (IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- Run this file against a fresh PostgreSQL database with the pgcrypto extension.
-- =============================================================================

-- =============================================================================
-- 1. UTILITY: updated_at trigger function
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. USERS & ROLES
-- =============================================================================

-- Roles define permission sets within the platform.
CREATE TABLE IF NOT EXISTS roles (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       TEXT NOT NULL UNIQUE,
  description                TEXT,
  can_checkout_quantifiable  BOOLEAN NOT NULL DEFAULT false,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE roles IS 'Platform roles controlling access and checkout privileges.';

-- Users are the core identity for all actors in the system.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

COMMENT ON TABLE users IS 'Platform users with soft-delete support.';

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Junction table linking users to their assigned roles.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id      UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by  UUID REFERENCES users(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

-- Seed default roles
INSERT INTO roles (name, description, can_checkout_quantifiable) VALUES
  ('admin',   'Full system access',                    true),
  ('staff',   'Inventory and document management',     true)
ON CONFLICT (name) DO NOTHING;

-- Trigger: auto-update users.updated_at
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 3. DOCUMENTS MODULE
-- =============================================================================

-- Hierarchical folder structure for document organization.
CREATE TABLE IF NOT EXISTS folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (parent_id, name)
);

COMMENT ON TABLE folders IS 'Hierarchical document folders with soft-delete.';

CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at) WHERE deleted_at IS NOT NULL;

-- Documents stored in the platform with versioning support.
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id     UUID REFERENCES folders(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  version       INT NOT NULL DEFAULT 1,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

COMMENT ON TABLE documents IS 'Stored documents with versioning and soft-delete.';

CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at) WHERE deleted_at IS NOT NULL;

-- Document version history for audit and rollback.
CREATE TABLE IF NOT EXISTS document_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version       INT NOT NULL,
  storage_path  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_document_id ON document_versions(document_id);

-- Granular permissions on documents or folders, assigned to users or roles.
CREATE TABLE IF NOT EXISTS document_permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID REFERENCES documents(id) ON DELETE CASCADE,
  folder_id    UUID REFERENCES folders(id)   ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id)     ON DELETE CASCADE,
  role_id      UUID REFERENCES roles(id)     ON DELETE CASCADE,
  permission   TEXT NOT NULL CHECK (permission IN ('viewer', 'editor', 'manager')),
  inherit      BOOLEAN NOT NULL DEFAULT true,
  granted_by   UUID NOT NULL REFERENCES users(id),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT target_xor CHECK (
    (document_id IS NOT NULL)::int + (folder_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT subject_xor CHECK (
    (user_id IS NOT NULL)::int + (role_id IS NOT NULL)::int = 1
  )
);

COMMENT ON TABLE document_permissions IS 'Permissions scoped to document or folder, granted to user or role.';

CREATE INDEX IF NOT EXISTS idx_doc_perm_document_id ON document_permissions(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_perm_folder_id ON document_permissions(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_perm_user_id ON document_permissions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_perm_role_id ON document_permissions(role_id) WHERE role_id IS NOT NULL;

-- One permission per subject+scope. Duplicates trigger ON CONFLICT in grantPermission().
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_perm_doc_user ON document_permissions(document_id, user_id) WHERE document_id IS NOT NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_perm_doc_role ON document_permissions(document_id, role_id) WHERE document_id IS NOT NULL AND role_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_perm_folder_user ON document_permissions(folder_id, user_id) WHERE folder_id IS NOT NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_perm_folder_role ON document_permissions(folder_id, role_id) WHERE folder_id IS NOT NULL AND role_id IS NOT NULL;

-- Activity log for document and folder events.
CREATE TABLE IF NOT EXISTS document_activity_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
  folder_id    UUID REFERENCES folders(id)   ON DELETE SET NULL,
  actor_id     UUID NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL
               CHECK (action IN (
                 'upload', 'download', 'delete', 'move',
                 'rename', 'permission_change', 'version_upload', 'create_folder'
               )),
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_activity_document_id ON document_activity_logs(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_activity_folder_id ON document_activity_logs(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_activity_actor_id ON document_activity_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_doc_activity_created_at ON document_activity_logs(created_at);

-- Triggers for updated_at in documents module
CREATE TRIGGER trg_folders_updated_at
BEFORE UPDATE ON folders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 4. INVENTORY BASE
-- =============================================================================

-- Master items table supporting both trackable (BLE-tagged) and quantifiable (lot-based) items.
CREATE TABLE IF NOT EXISTS items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type   TEXT NOT NULL CHECK (item_type IN ('trackable', 'quantifiable')),
  sku         TEXT UNIQUE,
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

COMMENT ON TABLE items IS 'Master inventory items: trackable (BLE) or quantifiable (lot-based).';

CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_sku ON items(sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_items_updated_at
BEFORE UPDATE ON items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. TRACKABLE INVENTORY (BLE / Real-time Presence)
-- =============================================================================

-- Physical rooms where devices and items are located.
CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  building    TEXT,
  floor       INT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

COMMENT ON TABLE rooms IS 'Physical rooms for trackable item presence tracking.';

-- BLE gateway / scanner devices deployed in rooms.
CREATE TABLE IF NOT EXISTS devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code     TEXT NOT NULL UNIQUE,
  room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
  name            TEXT,
  label           TEXT,
  rssi_range      INT DEFAULT -70,
  last_heartbeat  TIMESTAMPTZ,
  offline_since   TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE devices IS 'BLE gateway devices for scanning tags.';

CREATE INDEX IF NOT EXISTS idx_devices_room_id ON devices(room_id);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(is_active);

-- BLE tags assigned to trackable items.
CREATE TABLE IF NOT EXISTS ble_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_code    TEXT NOT NULL UNIQUE,
  item_id     UUID REFERENCES items(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES users(id),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ble_tags IS 'BLE tags linked to trackable inventory items.';

CREATE INDEX IF NOT EXISTS idx_ble_tags_item_id ON ble_tags(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ble_tags_code ON ble_tags(tag_code);

-- Current presence state of each trackable item (latest known location/status).
CREATE TABLE IF NOT EXISTS item_presence_state (
  item_id          UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  current_room_id  UUID REFERENCES rooms(id) ON DELETE SET NULL,
  presence_status  TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (presence_status IN (
                     'present', 'missing', 'inactive', 'maintenance', 'unknown', 'transporting'
                   )),
  last_seen_at     TIMESTAMPTZ,
  last_device_id   UUID REFERENCES devices(id) ON DELETE SET NULL,
  last_rssi        INT,
  missing_since    TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE item_presence_state IS 'Real-time presence state for trackable items.';

CREATE INDEX IF NOT EXISTS idx_presence_status ON item_presence_state(presence_status);
CREATE INDEX IF NOT EXISTS idx_presence_room ON item_presence_state(current_room_id);

-- Historical location/presence records for trackable items.
CREATE TABLE IF NOT EXISTS item_location_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  presence_status TEXT NOT NULL,
  rssi            INT,
  conflict_meta   JSONB,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE item_location_history IS 'Audit trail of trackable item location changes.';

CREATE INDEX IF NOT EXISTS idx_location_history_item_id ON item_location_history(item_id);
CREATE INDEX IF NOT EXISTS idx_location_history_recorded_at ON item_location_history(recorded_at);

-- =============================================================================
-- 6. QUANTIFIABLE INVENTORY (Lots, Checkout, Returns)
-- =============================================================================

-- Lot-based inventory for consumable/quantifiable items.
CREATE TABLE IF NOT EXISTS item_lots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  lot_code         TEXT NOT NULL,
  quantity_total   INT NOT NULL CHECK (quantity_total >= 0),
  quantity_on_hand INT NOT NULL CHECK (quantity_on_hand >= 0),
  quantity_out     INT NOT NULL DEFAULT 0 CHECK (quantity_out >= 0),
  purchased_at     DATE,
  expires_at       DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, lot_code),
  CONSTRAINT quantities_valid CHECK (quantity_on_hand + quantity_out <= quantity_total)
);

COMMENT ON TABLE item_lots IS 'Lot-based stock records for quantifiable items.';

CREATE INDEX IF NOT EXISTS idx_item_lots_item_id ON item_lots(item_id);

-- Checkout transactions for quantifiable items.
CREATE TABLE IF NOT EXISTS checkout_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_out_by  UUID NOT NULL REFERENCES users(id),
  processed_by    UUID REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'open', 'approved'
                  CHECK (status IN ('pending_approval', 'open', 'approved', 'partially_returned', 'closed', 'cancelled', 'rejected')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE checkout_transactions IS 'Checkout transactions for quantifiable inventory.';

CREATE INDEX IF NOT EXISTS idx_checkout_status ON checkout_transactions(status);
CREATE INDEX IF NOT EXISTS idx_checkout_user ON checkout_transactions(checked_out_by);

-- Individual line items within a checkout transaction.
CREATE TABLE IF NOT EXISTS checkout_transaction_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    UUID NOT NULL REFERENCES checkout_transactions(id) ON DELETE CASCADE,
  item_id           UUID NOT NULL REFERENCES items(id),
  lot_id            UUID NOT NULL REFERENCES item_lots(id),
  quantity_out      INT NOT NULL CHECK (quantity_out > 0),
  quantity_returned INT NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT return_not_exceed_out CHECK (quantity_returned <= quantity_out)
);

CREATE INDEX IF NOT EXISTS idx_cti_transaction ON checkout_transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_cti_item ON checkout_transaction_items(item_id);

-- Return transactions linked to a prior checkout.
CREATE TABLE IF NOT EXISTS return_transactions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_transaction_id  UUID NOT NULL REFERENCES checkout_transactions(id),
  returned_by              UUID NOT NULL REFERENCES users(id),
  processed_by             UUID REFERENCES users(id),
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_txn_checkout ON return_transactions(checkout_transaction_id);

-- Individual line items within a return transaction.
CREATE TABLE IF NOT EXISTS return_transaction_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_transaction_id UUID NOT NULL REFERENCES return_transactions(id) ON DELETE CASCADE,
  checkout_item_id      UUID NOT NULL REFERENCES checkout_transaction_items(id),
  quantity_returned     INT NOT NULL CHECK (quantity_returned > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Triggers for updated_at in quantifiable inventory
CREATE TRIGGER trg_item_lots_updated_at
BEFORE UPDATE ON item_lots
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_checkout_transactions_updated_at
BEFORE UPDATE ON checkout_transactions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 7. AUDITING & DEVICE EVENTS
-- =============================================================================

-- General-purpose audit log for entity state changes.
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  before_state JSONB,
  after_state  JSONB,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_logs IS 'General audit trail for entity mutations.';

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);

-- Raw device events from BLE gateways (sightings, heartbeats, errors).
CREATE TABLE IF NOT EXISTS device_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tag_id      UUID REFERENCES ble_tags(id) ON DELETE SET NULL,
  tag_code    TEXT NOT NULL,
  room_id     UUID REFERENCES rooms(id) ON DELETE SET NULL,
  rssi        INT,
  event_type  TEXT NOT NULL DEFAULT 'sighting'
              CHECK (event_type IN ('sighting', 'heartbeat', 'error')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE device_events IS 'Raw events from BLE gateway devices.';

CREATE INDEX IF NOT EXISTS idx_device_events_device ON device_events(device_id);
CREATE INDEX IF NOT EXISTS idx_device_events_tag ON device_events(tag_code);
CREATE INDEX IF NOT EXISTS idx_device_events_recorded ON device_events(recorded_at);

-- =============================================================================
-- SCHEMA COMPLETE
-- =============================================================================
