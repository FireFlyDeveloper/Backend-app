-- Migration 2: Documents

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

CREATE INDEX idx_folders_parent_id ON folders(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_folders_deleted_at ON folders(deleted_at) WHERE deleted_at IS NOT NULL;

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

CREATE INDEX idx_documents_folder_id ON documents(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at) WHERE deleted_at IS NOT NULL;

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

CREATE INDEX idx_document_versions_document_id ON document_versions(document_id);

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

CREATE INDEX idx_doc_perm_document_id ON document_permissions(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_doc_perm_folder_id ON document_permissions(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX idx_doc_perm_user_id ON document_permissions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_doc_perm_role_id ON document_permissions(role_id) WHERE role_id IS NOT NULL;

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

CREATE INDEX idx_doc_activity_document_id ON document_activity_logs(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_doc_activity_folder_id ON document_activity_logs(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX idx_doc_activity_actor_id ON document_activity_logs(actor_id);
CREATE INDEX idx_doc_activity_created_at ON document_activity_logs(created_at);

-- Triggers for updated_at
CREATE TRIGGER trg_folders_updated_at
BEFORE UPDATE ON folders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
