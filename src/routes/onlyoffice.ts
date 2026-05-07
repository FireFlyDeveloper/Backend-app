import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getDocumentById, resolveDocumentPermission, updateDocumentVersion, createDocumentVersion, logActivity, getStoragePath } from '../services/documentService';
import { generateEditorConfig, verifyCallbackToken, OnlyOfficeCallbackBody } from '../services/onlyofficeService';
import { config } from '../utils/config';
import { ForbiddenError } from '../utils/errors';

const router = Router();

// POST /onlyoffice/config/:docId — generates editor config for a document (authenticated)
router.post('/onlyoffice/config/:docId', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const docId = req.params.docId as string;
    const user = req.user!;

    // Fetch document
    const doc = await getDocumentById(docId);

    // Check permission
    const perm = await resolveDocumentPermission(user.id, user.roles, user.roles.includes('admin'), doc.id);
    if (!perm && !user.roles.includes('admin')) {
      throw new ForbiddenError('No permission to view this document');
    }

    const editorConfig = generateEditorConfig(doc, user.display_name, user.id, perm || 'viewer');

    res.json({
      config: editorConfig,
      documentServerUrl: config.officeDocServerUrl,
    });
  } catch (err) {
    next(err);
  }
});

// GET /onlyoffice/files/:docId/download — serve file to ONLYOFFICE Document Server (no app auth)
router.get('/onlyoffice/files/:docId/download', async (req: Request, res: Response, next) => {
  try {
    const docId = req.params.docId as string;
    const doc = await getDocumentById(docId);
    const filePath = path.join(getStoragePath(), doc.storage_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${doc.name}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// POST /onlyoffice/callback — receives saved file from ONLYOFFICE Document Server (no auth)
function downloadFile(fileUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(fileUrl);
    const mod = parsedUrl.protocol === 'https:' ? https : http;

    mod.get(parsedUrl, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        downloadFile(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

router.post('/onlyoffice/callback', async (req: Request, res: Response, next) => {
  try {
    const body: OnlyOfficeCallbackBody = req.body;
    let payload: any;

    // Verify the JWT token from the callback body
    try {
      payload = verifyCallbackToken(body);
    } catch {
      return res.status(403).json({ error: 1, message: 'Invalid token' });
    }

    const status = body.status;

    // status 2 = document ready for saving, status 6 = document being saved
    if (status === 2 || status === 6) {
      const callbackUrl = body.url;
      if (!callbackUrl) {
        return res.status(400).json({ error: 1, message: 'No file URL in callback' });
      }

      // Download the file from ONLYOFFICE using native http/https
      const fileBuffer = await downloadFile(callbackUrl);
      const fileSize = fileBuffer.length;
      const extension = body.filetype || 'docx';

      // Generate a unique storage filename
      const storageName = `${uuidv4()}.${extension}`;
      const filePath = path.join(getStoragePath(), storageName);

      // Ensure storage directory exists
      const storageDir = getStoragePath();
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }

      // Write the file to disk
      fs.writeFileSync(filePath, fileBuffer);

      // Determine document id from the callback payload or key
      // The key is in format: docId_v{version}
      const docId = payload?.document?.key?.split('_v')[0];
      if (!docId) {
        return res.status(400).json({ error: 1, message: 'Cannot determine document ID from callback' });
      }

      // Fetch current document to get the new version number
      const doc = await getDocumentById(docId);
      const newVersion = doc.version + 1;

      // Update the document record
      await updateDocumentVersion(docId, {
        storage_path: storageName,
        size_bytes: fileSize,
        version: newVersion,
      });

      // Create a new version record
      await createDocumentVersion({
        document_id: docId,
        version: newVersion,
        storage_path: storageName,
        size_bytes: fileSize,
        uploaded_by: 'onlyoffice',
      });

      // Log activity
      await logActivity({
        document_id: docId,
        actor_id: 'onlyoffice',
        action: 'onlyoffice_save',
        metadata: { version: newVersion, size: fileSize, mime_type: `application/${extension}` },
      });
    }

    // ONLYOFFICE expects { error: 0 } on success
    res.json({ error: 0 });
  } catch (err) {
    next(err);
  }
});

export default router;
