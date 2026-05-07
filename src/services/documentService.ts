import { query, withTransaction } from '../utils/db';
import { Folder, Document, DocumentVersion, DocumentPermission, PermissionLevel, DocumentActivityLog } from '../types';
import { NotFoundError, ForbiddenError, ConflictError } from '../utils/errors';
import { config } from '../utils/config';
import path from 'path';
import fs from 'fs';

// --- Permission Resolution ---

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
};

function higherPermission(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return PERMISSION_RANK[a] >= PERMISSION_RANK[b] ? a : b;
}

export async function resolveDocumentPermission(
  userId: string,
  userRoles: string[],
  isAdmin: boolean,
  documentId: string
): Promise<PermissionLevel | null> {
  if (isAdmin) return 'manager';

  // Step 2: explicit user permission on document
  const directUser = await query(
    `SELECT permission FROM document_permissions
     WHERE document_id = $1 AND user_id = $2`,
    [documentId, userId]
  );
  if (directUser.rows.length > 0) return directUser.rows[0].permission;

  // Step 3: role permission on document
  const directRole = await query(
    `SELECT dp.permission FROM document_permissions dp
     JOIN roles r ON r.id = dp.role_id
     WHERE dp.document_id = $1 AND r.name = ANY($2)`,
    [documentId, userRoles]
  );
  if (directRole.rows.length > 0) {
    return directRole.rows.reduce((best: PermissionLevel, r: any) => higherPermission(best, r.permission), directRole.rows[0].permission);
  }

  // Step 4 & 5: walk up folder tree
  const doc = await query(`SELECT folder_id FROM documents WHERE id = $1 AND deleted_at IS NULL`, [documentId]);
  if (doc.rows.length === 0) return null;
  let folderId: string | null = doc.rows[0].folder_id;

  while (folderId) {
    // User-level inherited
    const userInherit = await query(
      `SELECT permission FROM document_permissions
       WHERE folder_id = $1 AND user_id = $2 AND inherit = true`,
      [folderId, userId]
    );
    if (userInherit.rows.length > 0) return userInherit.rows[0].permission;

    // Role-level inherited
    const roleInherit = await query(
      `SELECT dp.permission FROM document_permissions dp
       JOIN roles r ON r.id = dp.role_id
       WHERE dp.folder_id = $1 AND r.name = ANY($2) AND dp.inherit = true`,
      [folderId, userRoles]
    );
    if (roleInherit.rows.length > 0) {
      return roleInherit.rows.reduce((best: PermissionLevel, r: any) => higherPermission(best, r.permission), roleInherit.rows[0].permission);
    }

    const parent = await query(`SELECT parent_id FROM folders WHERE id = $1 AND deleted_at IS NULL`, [folderId]);
    if (parent.rows.length === 0) break;
    folderId = parent.rows[0].parent_id;
  }

  return null;
}

export async function resolveFolderPermission(
  userId: string,
  userRoles: string[],
  isAdmin: boolean,
  folderId: string
): Promise<PermissionLevel | null> {
  if (isAdmin) return 'manager';

  let currentId: string | null = folderId;
  while (currentId) {
    const directUser = await query(
      `SELECT permission FROM document_permissions WHERE folder_id = $1 AND user_id = $2`,
      [currentId, userId]
    );
    if (directUser.rows.length > 0) return directUser.rows[0].permission;

    const directRole = await query(
      `SELECT dp.permission FROM document_permissions dp
       JOIN roles r ON r.id = dp.role_id
       WHERE dp.folder_id = $1 AND r.name = ANY($2)`,
      [currentId, userRoles]
    );
    if (directRole.rows.length > 0) {
      return directRole.rows.reduce((best: PermissionLevel, r: any) => higherPermission(best, r.permission), directRole.rows[0].permission);
    }

    const parent: any = await query(`SELECT parent_id FROM folders WHERE id = $1 AND deleted_at IS NULL`, [currentId]);
    if (parent.rows.length === 0) break;
    currentId = parent.rows[0].parent_id;
  }
  return null;
}

// --- Folders ---

export async function listVisibleFolders(userId: string, userRoles: string[], isAdmin: boolean): Promise<Folder[]> {
  if (isAdmin) {
    const result = await query(`SELECT * FROM folders WHERE deleted_at IS NULL ORDER BY name`);
    return result.rows;
  }

  const result = await query(
    `WITH RECURSIVE accessible AS (
      SELECT f.* FROM folders f
      JOIN document_permissions dp ON dp.folder_id = f.id
      WHERE f.deleted_at IS NULL
        AND (
          (dp.user_id = $1) OR
          (dp.role_id IN (SELECT id FROM roles WHERE name = ANY($2)))
        )
      UNION
      SELECT f.* FROM folders f
      JOIN documents d ON d.folder_id = f.id AND d.deleted_at IS NULL
      JOIN document_permissions dp ON dp.document_id = d.id
      WHERE f.deleted_at IS NULL
        AND (
          (dp.user_id = $1) OR
          (dp.role_id IN (SELECT id FROM roles WHERE name = ANY($2)))
        )
      UNION
      SELECT f.* FROM folders f
      JOIN accessible a ON a.parent_id = f.id
      WHERE f.deleted_at IS NULL
    )
    SELECT DISTINCT * FROM accessible ORDER BY name`,
    [userId, userRoles]
  );
  return result.rows;
}

export async function createFolder(data: {
  parent_id?: string | null;
  name: string;
  created_by: string;
}): Promise<Folder> {
  const existing = await query(
    `SELECT id, deleted_at FROM folders WHERE parent_id IS NOT DISTINCT FROM $1 AND name = $2`,
    [data.parent_id || null, data.name]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.deleted_at) {
      const result = await query(
        `UPDATE folders
         SET deleted_at = NULL,
             created_by = $1
         WHERE id = $2
         RETURNING *`,
        [data.created_by, row.id]
      );
      return result.rows[0];
    }
    throw new ConflictError('Folder already exists');
  }

  const result = await query(
    `INSERT INTO folders (parent_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.parent_id || null, data.name, data.created_by]
  );
  return result.rows[0];
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const result = await query(
    `UPDATE folders SET name = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
    [name, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Folder not found');
  return result.rows[0];
}

export async function moveFolder(id: string, parent_id: string | null): Promise<Folder> {
  if (parent_id) {
    let current: string | null = parent_id;
    while (current) {
      if (current === id) throw new ConflictError('Cannot move folder into itself or its descendants');
      const r: any = await query(`SELECT parent_id FROM folders WHERE id = $1`, [current]);
      current = r.rows.length ? r.rows[0].parent_id : null;
    }
  }
  const result = await query(
    `UPDATE folders SET parent_id = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
    [parent_id, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Folder not found');
  return result.rows[0];
}

export async function softDeleteFolder(id: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`UPDATE folders SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await client.query(`UPDATE documents SET deleted_at = now(), updated_at = now() WHERE folder_id = $1`, [id]);
  });
}

// --- Documents ---

export async function listDocumentsInFolder(folderId: string): Promise<Document[]> {
  const result = await query(
    `SELECT * FROM documents WHERE folder_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [folderId]
  );
  return result.rows;
}

export async function getDocumentById(id: string): Promise<Document> {
  const result = await query(`SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (result.rows.length === 0) throw new NotFoundError('Document not found');
  return result.rows[0];
}

export async function findDocumentByFolderAndName(folderId: string | null, name: string): Promise<Document | null> {
  const result = await query(
    `SELECT * FROM documents WHERE folder_id IS NOT DISTINCT FROM $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
    [folderId, name]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function createDocument(data: {
  folder_id?: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_by: string;
}): Promise<Document> {
  const existing = await query(
    `SELECT id, deleted_at FROM documents WHERE storage_path = $1`,
    [data.storage_path]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.deleted_at) {
      const result = await query(
        `UPDATE documents
         SET deleted_at = NULL,
             folder_id = $1,
             name = $2,
             mime_type = $3,
             size_bytes = $4,
             uploaded_by = $5
         WHERE id = $6
         RETURNING *`,
        [data.folder_id || null, data.name, data.mime_type, data.size_bytes, data.uploaded_by, row.id]
      );
      return result.rows[0];
    }
    throw new ConflictError('Document with this storage path already exists');
  }

  const result = await query(
    `INSERT INTO documents (folder_id, name, mime_type, size_bytes, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.folder_id || null, data.name, data.mime_type, data.size_bytes, data.storage_path, data.uploaded_by]
  );
  return result.rows[0];
}

export async function updateDocumentVersion(
  id: string,
  data: {
    storage_path: string;
    size_bytes: number;
    version: number;
  }
): Promise<Document> {
  const result = await query(
    `UPDATE documents
     SET storage_path = $1, size_bytes = $2, version = $3, updated_at = now()
     WHERE id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [data.storage_path, data.size_bytes, data.version, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Document not found');
  return result.rows[0];
}

export async function softDeleteDocument(id: string): Promise<void> {
  const result = await query(
    `UPDATE documents SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rowCount === 0) throw new NotFoundError('Document not found');
}

export async function renameDocument(id: string, name: string): Promise<Document> {
  const result = await query(
    `UPDATE documents SET name = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
    [name, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Document not found');
  return result.rows[0];
}

// --- Versions ---

export async function createDocumentVersion(data: {
  document_id: string;
  version: number;
  storage_path: string;
  size_bytes: number;
  uploaded_by: string;
}): Promise<DocumentVersion> {
  const result = await query(
    `INSERT INTO document_versions (document_id, version, storage_path, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.document_id, data.version, data.storage_path, data.size_bytes, data.uploaded_by]
  );
  return result.rows[0];
}

export async function listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  const result = await query(
    `SELECT * FROM document_versions WHERE document_id = $1 ORDER BY version DESC`,
    [documentId]
  );
  return result.rows;
}

// --- Permissions ---

export async function listDocumentPermissions(documentId: string): Promise<DocumentPermission[]> {
  const result = await query(
    `SELECT dp.*,
            u.display_name AS user_display_name,
            u.email AS user_email,
            r.name AS role_name
     FROM document_permissions dp
     LEFT JOIN users u ON u.id = dp.user_id
     LEFT JOIN roles r ON r.id = dp.role_id
     WHERE dp.document_id = $1`,
    [documentId]
  );
  return result.rows;
}

export async function listFolderPermissions(folderId: string): Promise<DocumentPermission[]> {
  const result = await query(
    `SELECT dp.*,
            u.display_name AS user_display_name,
            u.email AS user_email,
            r.name AS role_name
     FROM document_permissions dp
     LEFT JOIN users u ON u.id = dp.user_id
     LEFT JOIN roles r ON r.id = dp.role_id
     WHERE dp.folder_id = $1`,
    [folderId]
  );
  return result.rows;
}

export async function grantPermission(data: {
  document_id?: string | null;
  folder_id?: string | null;
  user_id?: string | null;
  role_id?: string | null;
  permission: PermissionLevel;
  inherit?: boolean;
  granted_by: string;
}): Promise<{ permission: DocumentPermission; created: boolean }> {
  // Upsert: check for existing permission for this subject+scope, update or insert
  const existing = await query(
    `SELECT id FROM document_permissions
     WHERE document_id IS NOT DISTINCT FROM $1
       AND folder_id IS NOT DISTINCT FROM $2
       AND user_id IS NOT DISTINCT FROM $3
       AND role_id IS NOT DISTINCT FROM $4`,
    [
      data.document_id || null,
      data.folder_id || null,
      data.user_id || null,
      data.role_id || null,
    ]
  );

  if (existing.rows.length > 0) {
    const result = await query(
      `UPDATE document_permissions
       SET permission = $1, inherit = $2, granted_by = $3, granted_at = now()
       WHERE id = $4
       RETURNING *`,
      [data.permission, data.inherit ?? true, data.granted_by, existing.rows[0].id]
    );
    return { permission: result.rows[0], created: false };
  }

  const result = await query(
    `INSERT INTO document_permissions (document_id, folder_id, user_id, role_id, permission, inherit, granted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.document_id || null,
      data.folder_id || null,
      data.user_id || null,
      data.role_id || null,
      data.permission,
      data.inherit ?? true,
      data.granted_by,
    ]
  );
  return { permission: result.rows[0], created: true };
}

export async function revokePermission(id: string): Promise<void> {
  const result = await query(`DELETE FROM document_permissions WHERE id = $1`, [id]);
  if (result.rowCount === 0) throw new NotFoundError('Permission not found');
}

// --- Activity Logs ---

export async function logActivity(data: {
  document_id?: string | null;
  folder_id?: string | null;
  actor_id: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO document_activity_logs (document_id, folder_id, actor_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.document_id || null, data.folder_id || null, data.actor_id, data.action, data.metadata ? JSON.stringify(data.metadata) : null]
  );
}

export async function listDocumentActivity(documentId: string): Promise<DocumentActivityLog[]> {
  const result = await query(
    `SELECT * FROM document_activity_logs WHERE document_id = $1 ORDER BY created_at DESC`,
    [documentId]
  );
  return result.rows;
}

export async function searchDocuments(queryStr: string, userId: string, userRoles: string[], isAdmin: boolean): Promise<Document[]> {
  const searchPattern = `%${queryStr}%`;
  const result = await query(
    `SELECT * FROM documents
     WHERE deleted_at IS NULL AND name ILIKE $1
     ORDER BY name`,
    [searchPattern]
  );

  if (isAdmin) return result.rows;

  // Filter by permission for non-admins
  const accessible: Document[] = [];
  for (const doc of result.rows) {
    const perm = await resolveDocumentPermission(userId, userRoles, isAdmin, doc.id);
    if (perm) accessible.push(doc);
  }
  return accessible;
}

export async function listAllAccessibleDocuments(
  userId: string,
  userRoles: string[],
  isAdmin: boolean
): Promise<Document[]> {
  if (isAdmin) {
    const result = await query(
      `SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC`
    );
    return result.rows;
  }

  const result = await query(
    `SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC`
  );
  const accessible: Document[] = [];
  for (const doc of result.rows) {
    const perm = await resolveDocumentPermission(userId, userRoles, isAdmin, doc.id);
    if (perm) accessible.push(doc);
  }
  return accessible;
}

// --- Storage helpers ---

export function getStoragePath(): string {
  return path.resolve(config.fileStoragePath);
}

export function ensureStorageDir(): void {
  const dir = getStoragePath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
