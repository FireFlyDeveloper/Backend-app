import { PoolClient } from 'pg';
import { indexExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  // 1. Remove duplicate permissions — keep the most recent (highest granted_at) for each subject+scope
  await client.query(`
    DELETE FROM document_permissions a
    USING document_permissions b
    WHERE a.granted_at < b.granted_at
      AND a.document_id IS NOT DISTINCT FROM b.document_id
      AND a.folder_id IS NOT DISTINCT FROM b.folder_id
      AND a.user_id IS NOT DISTINCT FROM b.user_id
      AND a.role_id IS NOT DISTINCT FROM b.role_id
  `);

  // 2. Add unique partial indexes to prevent future duplicates
  if (!(await indexExists(client, 'uq_doc_perm_doc_user'))) {
    await client.query(`
      CREATE UNIQUE INDEX uq_doc_perm_doc_user
      ON document_permissions(document_id, user_id)
      WHERE document_id IS NOT NULL AND user_id IS NOT NULL
    `);
  }

  if (!(await indexExists(client, 'uq_doc_perm_doc_role'))) {
    await client.query(`
      CREATE UNIQUE INDEX uq_doc_perm_doc_role
      ON document_permissions(document_id, role_id)
      WHERE document_id IS NOT NULL AND role_id IS NOT NULL
    `);
  }

  if (!(await indexExists(client, 'uq_doc_perm_folder_user'))) {
    await client.query(`
      CREATE UNIQUE INDEX uq_doc_perm_folder_user
      ON document_permissions(folder_id, user_id)
      WHERE folder_id IS NOT NULL AND user_id IS NOT NULL
    `);
  }

  if (!(await indexExists(client, 'uq_doc_perm_folder_role'))) {
    await client.query(`
      CREATE UNIQUE INDEX uq_doc_perm_folder_role
      ON document_permissions(folder_id, role_id)
      WHERE folder_id IS NOT NULL AND role_id IS NOT NULL
    `);
  }
}
