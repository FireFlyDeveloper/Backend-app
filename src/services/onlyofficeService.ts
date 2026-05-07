import jwt from 'jsonwebtoken';
import { config } from '../utils/config';
import { Document } from '../types';

export interface OnlyOfficeEditorConfig {
  document: {
    url: string;
    key: string;
    title: string;
    fileType: string;
  };
  editorConfig: {
    lang: string;
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
  userId: string
): OnlyOfficeEditorConfig {
  const downloadUrl = `${config.appUrl}/documents/${doc.id}/download`;

  // Derive file extension from mime type or name
  const parts = doc.name.split('.');
  const fileType = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'docx';

  // Unique key based on document id + version so ONLYOFFICE knows when to reload
  const key = `${doc.id}_v${doc.version}`;

  const payload = {
    document: {
      url: downloadUrl,
      key,
      title: doc.name,
    },
    editorConfig: {
      lang: 'en',
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
      fileType,
    },
    editorConfig: {
      lang: 'en',
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
