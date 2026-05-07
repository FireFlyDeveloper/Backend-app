import jwt from 'jsonwebtoken';
import { config } from '../utils/config';
import { Document, PermissionLevel } from '../types';

export interface OnlyOfficeEditorConfig {
  document: {
    url: string;
    key: string;
    title: string;
    fileType: string;
    permissions?: {
      edit?: boolean;
      download?: boolean;
    };
  };
  documentType: 'word' | 'cell' | 'slide';
  editorConfig: {
    lang: string;
    callbackUrl: string;
    user: {
      id: string;
      name: string;
    };
  };
  token: string;
}

export function generateEditorConfig(
  doc: Document,
  userName: string,
  userId: string,
  permissionLevel?: PermissionLevel
): OnlyOfficeEditorConfig {
  const downloadUrl = `${config.appUrl}/onlyoffice/files/${doc.id}/download`;
  const callbackUrl = `${config.appUrl}/onlyoffice/callback`;

  // Derive file extension from name
  const parts = doc.name.split('.');
  const ext = (parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'docx');

  // Map extension to ONLYOFFICE documentType
  const docTypeMap: Record<string, 'word' | 'cell' | 'slide'> = {
    docx: 'word', doc: 'word', docm: 'word', dotx: 'word', dotm: 'word', odt: 'word', rtf: 'word', txt: 'word',
    xlsx: 'cell', xls: 'cell', xlsm: 'cell', xltx: 'cell', xltm: 'cell', ods: 'cell', csv: 'cell',
    pptx: 'slide', ppt: 'slide', pptm: 'slide', ppsx: 'slide', ppsm: 'slide', odp: 'slide',
  };
  const documentType = docTypeMap[ext] || 'word';

  // Unique key based on document id + version so ONLYOFFICE knows when to reload
  const key = `${doc.id}_v${doc.version}`;

  // Restrict editing for viewer-level users
  const docPermissions = permissionLevel === 'viewer'
    ? { edit: false, download: true }
    : undefined;

  const payload = {
    document: {
      url: downloadUrl,
      key,
      title: doc.name,
      fileType: ext,
      permissions: docPermissions,
    },
    documentType,
    editorConfig: {
      lang: 'en',
      callbackUrl,
      user: {
        id: userId,
        name: userName,
      },
    },
  };

  const token = jwt.sign(payload, config.officeJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });

  return {
    document: {
      url: downloadUrl,
      key,
      title: doc.name,
      fileType: ext,
      ...(docPermissions ? { permissions: docPermissions } : {}),
    },
    documentType,
    editorConfig: {
      lang: 'en',
      callbackUrl,
      user: {
        id: userId,
        name: userName,
      },
    },
    token,
  };
}

export interface OnlyOfficeCallbackBody {
  token?: string;
  status?: number;
  url?: string;
  key?: string;
  users?: string[];
  actions?: unknown[];
  history?: unknown;
  filetype?: string;
}

export function verifyCallbackToken(body: OnlyOfficeCallbackBody): any {
  if (body.token) {
    try {
      return jwt.verify(body.token, config.officeJwtSecret);
    } catch {
      throw new Error('Invalid ONLYOFFICE callback token');
    }
  }
  throw new Error('Missing ONLYOFFICE callback token');
}
