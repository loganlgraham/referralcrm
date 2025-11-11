import crypto from 'crypto';

interface UploadParams {
  key: string;
  body: Uint8Array;
  contentType?: string;
  messageId?: string;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

function hasGcsConfiguration(): boolean {
  return Boolean(
    process.env.GCP_STORAGE_CLIENT_EMAIL &&
      process.env.GCP_STORAGE_PRIVATE_KEY &&
      process.env.INBOUND_EMAIL_BUCKET
  );
}

function getPrivateKey(): string | null {
  const rawKey = process.env.GCP_STORAGE_PRIVATE_KEY;
  if (!rawKey) {
    return null;
  }
  return rawKey.includes('\n') ? rawKey : rawKey.replace(/\\n/g, '\n');
}

function base64UrlEncode(value: Buffer | string): string {
  const buffer =
    typeof value === 'string'
      ? Buffer.from(value)
      : Buffer.isBuffer(value)
        ? value
        : Buffer.from(value);

  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(): Promise<string | null> {
  if (!hasGcsConfiguration()) {
    return null;
  }

  const clientEmail = process.env.GCP_STORAGE_CLIENT_EMAIL as string;
  const privateKey = getPrivateKey();
  if (!privateKey) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.accessToken;
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope: STORAGE_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600
    })
  );

  const unsignedAssertion = `${header}.${payload}`;

  let signature: string;
  try {
    signature = crypto
      .createSign('RSA-SHA256')
      .update(unsignedAssertion)
      .sign(privateKey, 'base64');
  } catch (error) {
    console.error('Failed to sign GCS access token assertion', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }

  const assertion = `${unsignedAssertion}.${signature
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')}`;

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    });

    if (!response.ok) {
      console.error('Failed to retrieve GCS access token', {
        status: response.status
      });
      return null;
    }

    const data = (await response.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number }
      | null;

    if (!data?.access_token) {
      console.error('GCS access token response missing token');
      return null;
    }

    const expiresIn = data.expires_in ?? 3600;
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: now + Math.min(expiresIn, 3600)
    };

    return data.access_token;
  } catch (error) {
    console.error('Error fetching GCS access token', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

export async function uploadEmailAttachment(params: UploadParams): Promise<string | null> {
  if (!hasGcsConfiguration()) {
    return null;
  }

  const bucket = process.env.INBOUND_EMAIL_BUCKET as string;
  const token = await getAccessToken();
  if (!token) {
    return null;
  }

  const objectName = params.key.replace(/^\/+/, '');
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(
    bucket
  )}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;

  try {
    const body =
      params.body instanceof Uint8Array ? params.body : new Uint8Array(params.body);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': params.contentType ?? 'application/octet-stream',
        'Content-Length': body.byteLength.toString()
      },
      body
    });

    if (!response.ok) {
      console.error('Inbound email attachment upload failed', {
        messageId: params.messageId,
        key: objectName,
        status: response.status
      });
      return null;
    }

    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${objectName
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;

    return publicUrl;
  } catch (error) {
    console.error('Inbound email attachment upload error', {
      messageId: params.messageId,
      key: objectName,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}
