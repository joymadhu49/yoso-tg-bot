import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  let raw = process.env.BOT_ENCRYPTION_KEY;

  if (!raw) {
    // Auto-generate and persist to .encryption_key
    const keyFile = join(process.cwd(), '.encryption_key');
    if (existsSync(keyFile)) {
      raw = readFileSync(keyFile, 'utf-8').trim();
    } else {
      raw = randomBytes(32).toString('hex');
      writeFileSync(keyFile, raw, { mode: 0o600 });
      console.log('🔑 Auto-generated encryption key (saved to .encryption_key)');
    }
  }

  return createHash('sha256').update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(data: string): string {
  const key = getKey();
  const [ivHex, tagHex, ciphertextHex] = data.split(':');
  if (!ivHex || !tagHex || !ciphertextHex) throw new Error('Invalid encrypted data format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
