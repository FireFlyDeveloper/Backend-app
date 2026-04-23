import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../utils/config';
import {
  listVisibleFolders,
  createFolder,
  renameFolder,
  moveFolder,
  softDeleteFolder,
  listDocumentsInFolder,
  getDocumentById,
  createDocument,
  softDeleteDocument,
  createDocumentVersion,
  listDocumentVersions,
  updateDocumentVersion,
  resolveDocumentPermission,
  resolveFolderPermission,
  grantPermission,
  revokePermission,
  listDocumentPermissions,
  listFolderPermissions,
  logActivity,
  listDocumentActivity,
  getStoragePath,
  ensureStorageDir,
} from '../services/documentService';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { PermissionLevel } from '../types';

function getUserContext(req: AuthRequest) {
  const user = req.user;
  if (!user) throw new ForbiddenError();
  const isAdmin = user.roles.includes('admin');
  return { userId: user.id, userRoles: user.roles as string[], isAdmin };
}

// --- Folders ---

export async function getFolders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const folders = await listVisibleFolders(ctx.userId, ctx.userRoles, ctx.isAdmin);
    res.json({ folders });
  } catch (err) {
    next(err);
  }
}

export async function postFolder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const { name, parent_id } = req.body;
    if (!name) throw new ValidationError('name is required');

    if (parent_id) {
      const perm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, parent_id as string);
      if (!perm || (perm !== 'editor' && perm !== 'manager' && !ctx.isAdmin)) {
        throw new ForbiddenError('Editor permission required on parent folder');
      }
    } else if (!ctx.isAdmin) {
      throw new ForbiddenError('Only admins can create root folders');
    }

    const folder = await createFolder({ parent_id: parent_id || null, name, created_by: ctx.userId });
    await logActivity({ folder_id: folder.id, actor_id: ctx.userId, action: 'create_folder' });
    res.status(201).json({ folder });
  } catch (err) {
    next(err);
  }
}

export async function patchFolder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const { name, parent_id } = req.body;
    const folderId = req.params.id as string;

    const perm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, folderId);
    if (!perm || (perm !== 'editor' && perm !== 'manager' && !ctx.isAdmin)) {
      throw new ForbiddenError('Editor permission required');
    }

    let folder: any;
    const hasName = name !== undefined;
    const hasParent = parent_id !== undefined;

    if (hasName && !hasParent) {
      folder = await renameFolder(folderId, name);
      await logActivity({ folder_id: folder.id, actor_id: ctx.userId, action: 'rename', metadata: { name } });
    } else if (hasParent && !hasName) {
      folder = await moveFolder(folderId, parent_id || null);
      await logActivity({ folder_id: folder.id, actor_id: ctx.userId, action: 'move', metadata: { parent_id } });
    } else if (hasName && hasParent) {
      await renameFolder(folderId, name);
      folder = await moveFolder(folderId, parent_id || null);
      await logActivity({ folder_id: folder.id, actor_id: ctx.userId, action: 'move', metadata: { name, parent_id } });
    } else {
      throw new ValidationError('No valid fields to update');
    }

    res.json({ folder });
  } catch (err) {
    next(err);
  }
}

export async function deleteFolder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const perm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, req.params.id as string);
    if (!perm || (perm !== 'manager' && !ctx.isAdmin)) {
      throw new ForbiddenError('Manager permission required to delete folder');
    }
    await softDeleteFolder(req.params.id as string);
    await logActivity({ folder_id: req.params.id as string, actor_id: ctx.userId, action: 'delete' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// --- Documents ---

export async function getFolderDocuments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const folderId = req.params.id as string;
    const perm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, folderId);
    if (!perm && !ctx.isAdmin) {
      const docs = await listDocumentsInFolder(folderId);
      const accessible = [];
      for (const doc of docs) {
        const dp = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
        if (dp) accessible.push(doc);
      }
      return res.json({ documents: accessible });
    }
    const documents = await listDocumentsInFolder(folderId);
    res.json({ documents });
  } catch (err) {
    next(err);
  }
}

export async function uploadDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const { folder_id, name } = req.body;
    const file = (req as any).file;
    if (!file) throw new ValidationError('File is required');

    if (folder_id) {
      const perm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, folder_id as string);
      if (!perm || (perm !== 'editor' && perm !== 'manager' && !ctx.isAdmin)) {
        throw new ForbiddenError('Editor permission required on folder');
      }
    } else if (!ctx.isAdmin) {
      throw new ForbiddenError('Only admins can upload to root');
    }

    ensureStorageDir();
    const ext = path.extname(file.originalname);
    const storageName = `${uuidv4()}${ext}`;
    const destPath = path.join(getStoragePath(), storageName);
    fs.renameSync(file.path, destPath);

    const doc = await createDocument({
      folder_id: folder_id || null,
      name: name || file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      storage_path: storageName,
      uploaded_by: ctx.userId,
    });

    await createDocumentVersion({
      document_id: doc.id,
      version: 1,
      storage_path: storageName,
      size_bytes: file.size,
      uploaded_by: ctx.userId,
    });

    await logActivity({ document_id: doc.id, actor_id: ctx.userId, action: 'upload', metadata: { size: file.size, mime_type: file.mimetype } });
    res.status(201).json({ document: doc });
  } catch (err) {
    next(err);
  }
}

export async function reuploadDocumentVersion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const docId = req.params.id as string;
    const file = (req as any).file;
    if (!file) throw new ValidationError('File is required');

    const doc = await getDocumentById(docId);

    // Check permission: editor+ or manager
    const perm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, docId);
    if (!perm || (perm !== 'editor' && perm !== 'manager' && !ctx.isAdmin)) {
      throw new ForbiddenError('Editor permission required to upload new version');
    }

    ensureStorageDir();
    const ext = path.extname(file.originalname);
    const storageName = `${uuidv4()}${ext}`;
    const destPath = path.join(getStoragePath(), storageName);
    fs.renameSync(file.path, destPath);

    // Save old version to document_versions
    await createDocumentVersion({
      document_id: doc.id,
      version: doc.version,
      storage_path: doc.storage_path,
      size_bytes: doc.size_bytes,
      uploaded_by: doc.uploaded_by,
    });

    // Update document with new version
    const newVersion = doc.version + 1;
    const updatedDoc = await updateDocumentVersion(docId, {
      storage_path: storageName,
      size_bytes: file.size,
      version: newVersion,
    });

    await logActivity({
      document_id: doc.id,
      actor_id: ctx.userId,
      action: 'version_upload',
      metadata: { version: newVersion, size: file.size, mime_type: file.mimetype },
    });

    res.status(200).json({ document: updatedDoc });
  } catch (err) {
    next(err);
  }
}

export async function downloadDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const doc = await getDocumentById(req.params.id as string);
    const perm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
    if (!perm && !ctx.isAdmin) throw new ForbiddenError('No permission to download');

    const filePath = path.join(getStoragePath(), doc.storage_path);
    if (!fs.existsSync(filePath)) throw new NotFoundError('File not found on disk');

    await logActivity({ document_id: doc.id, actor_id: ctx.userId, action: 'download' });
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
}

export async function deleteDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const doc = await getDocumentById(req.params.id as string);
    const perm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
    if (!perm || (perm !== 'manager' && !ctx.isAdmin)) {
      throw new ForbiddenError('Manager permission required to delete');
    }
    await softDeleteDocument(req.params.id as string);
    await logActivity({ document_id: doc.id, actor_id: ctx.userId, action: 'delete' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getDocumentVersions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const doc = await getDocumentById(req.params.id as string);
    const perm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
    if (!perm && !ctx.isAdmin) throw new ForbiddenError();
    const versions = await listDocumentVersions(req.params.id as string);
    res.json({ versions });
  } catch (err) {
    next(err);
  }
}

export async function getDocumentActivity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const doc = await getDocumentById(req.params.id as string);
    const perm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
    if (!perm && !ctx.isAdmin) throw new ForbiddenError();
    const activity = await listDocumentActivity(req.params.id as string);
    res.json({ activity });
  } catch (err) {
    next(err);
  }
}

// --- Permissions ---

export async function getDocumentPermissions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const doc = await getDocumentById(req.params.id as string);
    const perm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
    if (!perm || (perm !== 'manager' && !ctx.isAdmin)) throw new ForbiddenError('Manager permission required');
    const permissions = await listDocumentPermissions(req.params.id as string);
    res.json({ permissions });
  } catch (err) {
    next(err);
  }
}

export async function postDocumentPermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const doc = await getDocumentById(req.params.id as string);
    const userPerm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
    if (!userPerm || (userPerm !== 'manager' && !ctx.isAdmin)) throw new ForbiddenError('Manager permission required');

    const { user_id, role_id, permission, inherit } = req.body;
    if (!permission) throw new ValidationError('permission is required');
    if (!user_id && !role_id) throw new ValidationError('user_id or role_id is required');

    if (userPerm === 'manager' && permission === 'manager' && !ctx.isAdmin) {
      throw new ForbiddenError('Only admins can grant manager permission');
    }

    const dp = await grantPermission({
      document_id: req.params.id as string,
      user_id: user_id || null,
      role_id: role_id || null,
      permission,
      inherit: inherit ?? false,
      granted_by: ctx.userId,
    });

    await logActivity({ document_id: doc.id, actor_id: ctx.userId, action: 'permission_change', metadata: { permission_id: dp.id, granted: permission } });
    res.status(201).json({ permission: dp });
  } catch (err) {
    next(err);
  }
}

export async function deleteDocumentPermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const doc = await getDocumentById(req.params.id as string);
    const userPerm = await resolveDocumentPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, doc.id);
    if (!userPerm || (userPerm !== 'manager' && !ctx.isAdmin)) throw new ForbiddenError('Manager permission required');
    await revokePermission(req.params.pid as string);
    await logActivity({ document_id: doc.id, actor_id: ctx.userId, action: 'permission_change', metadata: { revoked: req.params.pid as string } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getFolderPermissions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const perm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, req.params.id as string);
    if (!perm || (perm !== 'manager' && !ctx.isAdmin)) throw new ForbiddenError('Manager permission required');
    const permissions = await listFolderPermissions(req.params.id as string);
    res.json({ permissions });
  } catch (err) {
    next(err);
  }
}

export async function postFolderPermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const userPerm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, req.params.id as string);
    if (!userPerm || (userPerm !== 'manager' && !ctx.isAdmin)) throw new ForbiddenError('Manager permission required');

    const { user_id, role_id, permission, inherit } = req.body;
    if (!permission) throw new ValidationError('permission is required');
    if (!user_id && !role_id) throw new ValidationError('user_id or role_id is required');

    if (userPerm === 'manager' && permission === 'manager' && !ctx.isAdmin) {
      throw new ForbiddenError('Only admins can grant manager permission');
    }

    const dp = await grantPermission({
      folder_id: req.params.id as string,
      user_id: user_id || null,
      role_id: role_id || null,
      permission,
      inherit: inherit ?? true,
      granted_by: ctx.userId,
    });

    await logActivity({ folder_id: req.params.id as string, actor_id: ctx.userId, action: 'permission_change', metadata: { permission_id: dp.id } });
    res.status(201).json({ permission: dp });
  } catch (err) {
    next(err);
  }
}

export async function deleteFolderPermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const userPerm = await resolveFolderPermission(ctx.userId, ctx.userRoles, ctx.isAdmin, req.params.id as string);
    if (!userPerm || (userPerm !== 'manager' && !ctx.isAdmin)) throw new ForbiddenError('Manager permission required');
    await revokePermission(req.params.pid as string);
    await logActivity({ folder_id: req.params.id as string, actor_id: ctx.userId, action: 'permission_change', metadata: { revoked: req.params.pid as string } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
