import { PoolClient } from 'pg';
import { indexExists, triggerExists, dropTriggerIfExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id   UUID REFERENCES folders(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      created_by  UUID NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at  TIMESTAMPTZ,
      UNIQUE (parent_id, name)
    )
  `);

  if (!(await indexExists(client, 'idx_folders_parent_id'))) {
    await client.query(`CREATE INDEX idx_folders_parent_id ON folders(parent_id) WHERE deleted_at IS NULL`);
  }
  if (!(await indexExists(client, 'idx_folders_deleted_at'))) {
    await client.query(`CREATE INDEX idx_folders_deleted_at ON folders(deleted_at) WHERE deleted_at IS NOT NULL`);
  }

  await client.query(`
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
    )
  `);

  if (!(await indexExists(client, 'idx_documents_folder_id'))) {
    await client.query(`CREATE INDEX idx_documents_folder_id ON documents(folder_id) WHERE deleted_at IS NULL`);
  }
  if (!(await indexExists(client, 'idx_documents_uploaded_by'))) {
    await client.query(`CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by)`);
  }
  if (!(await indexExists(client, 'idx_documents_deleted_at'))) {
    await client.query(`CREATE INDEX idx_documents_deleted_at ON documents(deleted_at) WHERE deleted_at IS NOT NULL`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS document_versions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version       INT NOT NULL,
      storage_path  TEXT NOT NULL,
      size_bytes    BIGINT NOT NULL,
      uploaded_by   UUID NOT NULL REFERENCES users(id),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (document_id, version)
    )
  `);

  if (!(await indexExists(client, 'idx_document_versions_document_id'))) {
    await client.query(`CREATE INDEX idx_document_versions_document_id ON document_versions(document_id)`);
  }

  await client.query(`
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
    )
  `);

  if (!(await indexExists(client, 'idx_doc_perm_document_id'))) {
    await client.query(`CREATE INDEX idx_doc_perm_document_id ON document_permissions(document_id) WHERE document_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'idx_doc_perm_folder_id'))) {
    await client.query(`CREATE INDEX idx_doc_perm_folder_id ON document_permissions(folder_id) WHERE folder_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'idx_doc_perm_user_id'))) {
    await client.query(`CREATE INDEX idx_doc_perm_user_id ON document_permissions(user_id) WHERE user_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'idx_doc_perm_role_id'))) {
    await client.query(`CREATE INDEX idx_doc_perm_role_id ON document_permissions(role_id) WHERE role_id IS NOT NULL`);
  }

  // Unique constraints to prevent duplicate permission grants
  if (!(await indexExists(client, 'uq_doc_perm_doc_user'))) {
    await client.query(`CREATE UNIQUE INDEX uq_doc_perm_doc_user ON document_permissions(document_id, user_id) WHERE document_id IS NOT NULL AND user_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'uq_doc_perm_doc_role'))) {
    await client.query(`CREATE UNIQUE INDEX uq_doc_perm_doc_role ON document_permissions(document_id, role_id) WHERE document_id IS NOT NULL AND role_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'uq_doc_perm_folder_user'))) {
    await client.query(`CREATE UNIQUE INDEX uq_doc_perm_folder_user ON document_permissions(folder_id, user_id) WHERE folder_id IS NOT NULL AND user_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'uq_doc_perm_folder_role'))) {
    await client.query(`CREATE UNIQUE INDEX uq_doc_perm_folder_role ON document_permissions(folder_id, role_id) WHERE folder_id IS NOT NULL AND role_id IS NOT NULL`);
  }

  await client.query(`
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
    )
  `);

  if (!(await indexExists(client, 'idx_doc_activity_document_id'))) {
    await client.query(`CREATE INDEX idx_doc_activity_document_id ON document_activity_logs(document_id) WHERE document_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'idx_doc_activity_folder_id'))) {
    await client.query(`CREATE INDEX idx_doc_activity_folder_id ON document_activity_logs(folder_id) WHERE folder_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'idx_doc_activity_actor_id'))) {
    await client.query(`CREATE INDEX idx_doc_activity_actor_id ON document_activity_logs(actor_id)`);
  }
  if (!(await indexExists(client, 'idx_doc_activity_created_at'))) {
    await client.query(`CREATE INDEX idx_doc_activity_created_at ON document_activity_logs(created_at)`);
  }

  if (!(await triggerExists(client, 'trg_folders_updated_at', 'folders'))) {
    await client.query(`
      CREATE TRIGGER trg_folders_updated_at
      BEFORE UPDATE ON folders
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }

  if (!(await triggerExists(client, 'trg_documents_updated_at', 'documents'))) {
    await client.query(`
      CREATE TRIGGER trg_documents_updated_at
      BEFORE UPDATE ON documents
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }
}

export async function down(client: PoolClient): Promise<void> {
  await dropTriggerIfExists(client, 'trg_documents_updated_at', 'documents');
  await dropTriggerIfExists(client, 'trg_folders_updated_at', 'folders');
  await client.query(`DROP TABLE IF EXISTS document_activity_logs CASCADE`);
  await client.query(`DROP TABLE IF EXISTS document_permissions CASCADE`);
  await client.query(`DROP TABLE IF EXISTS document_versions CASCADE`);
  await client.query(`DROP TABLE IF EXISTS documents CASCADE`);
  await client.query(`DROP TABLE IF EXISTS folders CASCADE`);
}
