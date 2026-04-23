import { Router } from 'express';
import multer from 'multer';
import {
  getFolders,
  postFolder,
  patchFolder,
  deleteFolder,
  getFolderDocuments,
  uploadDocument,
  reuploadDocumentVersion,
  downloadDocument,
  deleteDocument,
  getDocumentVersions,
  getDocumentActivity,
  getDocumentPermissions,
  postDocumentPermission,
  deleteDocumentPermission,
  getFolderPermissions,
  postFolderPermission,
  deleteFolderPermission,
} from '../controllers/documentController';
import { authenticate } from '../middleware/auth';

const upload = multer({ dest: 'uploads/' });
const router = Router();

router.use(authenticate);

// Folders
router.get('/folders', getFolders);
router.post('/folders', postFolder);
router.patch('/folders/:id', patchFolder);
router.delete('/folders/:id', deleteFolder);
router.get('/folders/:id/documents', getFolderDocuments);
router.get('/folders/:id/permissions', getFolderPermissions);
router.post('/folders/:id/permissions', postFolderPermission);
router.delete('/folders/:id/permissions/:pid', deleteFolderPermission);

// Documents
router.post('/documents/upload', upload.single('file'), uploadDocument);
router.post('/documents/:id/upload', upload.single('file'), reuploadDocumentVersion);
router.get('/documents/:id/download', downloadDocument);
router.delete('/documents/:id', deleteDocument);
router.get('/documents/:id/versions', getDocumentVersions);
router.get('/documents/:id/activity', getDocumentActivity);
router.get('/documents/:id/permissions', getDocumentPermissions);
router.post('/documents/:id/permissions', postDocumentPermission);
router.delete('/documents/:id/permissions/:pid', deleteDocumentPermission);

export default router;
