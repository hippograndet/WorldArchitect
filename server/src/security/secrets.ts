import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function getKey(): Buffer | null {
  const raw = process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY;
  if (!raw) return null;
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(value: string): string {
  const key = getKey();
  if (!key) {
    if (process.env.APP_MODE === 'hosted') throw new Error('PROVIDER_SETTINGS_ENCRYPTION_KEY is required in hosted mode');
    return value;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64url')}`;
}

export function decryptSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) throw new Error('PROVIDER_SETTINGS_ENCRYPTION_KEY is required to decrypt provider settings');

  const payload = Buffer.from(value.slice(PREFIX.length), 'base64url');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function isEncryptedSecret(value: string | undefined): boolean {
  return !!value?.startsWith(PREFIX);
}
