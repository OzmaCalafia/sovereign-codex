// Strict validation of .sc backup files before anything touches the local database.
import type { AuditLog, EntryRecord, VaultConfig } from '../db/database';
import { decryptData, encryptData, unwrapMasterKey } from './crypto';

export const BACKUP_VERSION = 1;
export const ENCRYPTED_BACKUP_VERSION = 2;
const MAX_BACKUP_CHARS = 50_000_000;

export interface BackupPayload {
  version: number;
  exportedAt: number;
  vaultConfig: VaultConfig;
  entries: EntryRecord[];
  auditLogs: AuditLog[];
}

export interface EncryptedBackupEnvelope {
  version: typeof ENCRYPTED_BACKUP_VERSION;
  keySlots: Pick<VaultConfig, 'salt' | 'wrappedMEKByPassword' | 'wrappedMEKBySeed'>;
  backupSalt: string;
  ciphertext: string;
}

export type BackupCredential = 'password' | 'recoveryPhrase';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isByteArray = (value: unknown, length?: number): value is number[] =>
  Array.isArray(value) &&
  (length === undefined || value.length === length) &&
  value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

/** True when `value` is JSON text holding an AES-GCM payload with a 12-byte IV and byte-array body. */
function isEncryptedJson(value: unknown, bodyKey: 'ciphertext' | 'wrappedKey'): boolean {
  if (!isString(value)) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) && isByteArray(parsed.iv, 12) && isByteArray(parsed[bodyKey]);
  } catch {
    return false;
  }
}

function unknownFields(raw: Record<string, unknown>, knownFields: string[], preserveUnknown: boolean): Record<string, unknown> {
  if (!preserveUnknown) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !knownFields.includes(key)));
}

function readVaultConfig(raw: unknown, preserveUnknown = false): VaultConfig {
  if (!isObject(raw)) throw new Error('Missing [SC] key data.');
  if (!isString(raw.salt) || !/^[0-9a-f]{32}$/i.test(raw.salt)) throw new Error('Invalid salt.');
  if (!isEncryptedJson(raw.wrappedMEKByPassword, 'wrappedKey')) throw new Error('Invalid password key.');
  if (!isEncryptedJson(raw.wrappedMEKBySeed, 'wrappedKey')) throw new Error('Invalid recovery key.');
  if (raw.encryptedSignature !== undefined && !isEncryptedJson(raw.encryptedSignature, 'ciphertext')) throw new Error('Invalid signature.');
  if (!isTimestamp(raw.createdAt)) throw new Error('Invalid creation date.');

  return {
    ...unknownFields(raw, ['id', 'salt', 'wrappedMEKByPassword', 'wrappedMEKBySeed', 'encryptedSignature', 'createdAt'], preserveUnknown),
    salt: raw.salt,
    wrappedMEKByPassword: raw.wrappedMEKByPassword as string,
    wrappedMEKBySeed: raw.wrappedMEKBySeed as string,
    ...(raw.encryptedSignature !== undefined && { encryptedSignature: raw.encryptedSignature as string }),
    createdAt: raw.createdAt,
  };
}

function readEntry(raw: unknown, position: number, preserveUnknown = false): EntryRecord {
  const label = `Entry ${position + 1}`;
  if (!isObject(raw)) throw new Error(`${label} is malformed.`);
  if (!isString(raw.title) || !isString(raw.category)) throw new Error(`${label} has an invalid title.`);
  if (!Array.isArray(raw.tags) || !raw.tags.every(isString)) throw new Error(`${label} has invalid tags.`);
  if (raw.isEncrypted !== true || !isEncryptedJson(raw.content, 'ciphertext')) throw new Error(`${label} is not a valid encrypted entry.`);
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) throw new Error(`${label} has an invalid date.`);

  return {
    ...unknownFields(raw, ['id', 'title', 'category', 'tags', 'isEncrypted', 'content', 'createdAt', 'updatedAt'], preserveUnknown),
    title: raw.title,
    category: raw.category,
    tags: raw.tags as string[],
    isEncrypted: true,
    content: raw.content as string,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function readAuditLog(raw: unknown, position: number, preserveUnknown = false): AuditLog {
  if (!isObject(raw) || !isString(raw.action) || !isString(raw.details) || !isTimestamp(raw.timestamp)) {
    throw new Error(`Log ${position + 1} is malformed.`);
  }
  return {
    ...unknownFields(raw, ['id', 'action', 'details', 'timestamp'], preserveUnknown),
    action: raw.action,
    details: raw.details,
    timestamp: raw.timestamp,
  };
}

function bytesFromHex(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
}

async function deriveBackupKey(masterKey: CryptoKey, saltHex: string): Promise<CryptoKey> {
  const rawMasterKey = await window.crypto.subtle.exportKey('raw', masterKey);
  const keyMaterial = await window.crypto.subtle.importKey('raw', rawMasterKey, 'HKDF', false, ['deriveKey']);
  const saltBytes = bytesFromHex(saltHex);
  const saltBuffer = saltBytes.buffer.slice(saltBytes.byteOffset, saltBytes.byteOffset + saltBytes.byteLength) as ArrayBuffer;

  return window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBuffer,
      info: new TextEncoder().encode('sovereign-codex:backup:v2'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts the complete legacy payload; the envelope exposes only credential key slots and crypto salt. */
export async function encryptBackupPayload(
  payload: BackupPayload,
  keySlots: EncryptedBackupEnvelope['keySlots'],
  masterKey: CryptoKey,
): Promise<EncryptedBackupEnvelope> {
  const backupSalt = Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const backupKey = await deriveBackupKey(masterKey, backupSalt);

  return {
    version: ENCRYPTED_BACKUP_VERSION,
    keySlots,
    backupSalt,
    ciphertext: await encryptData(JSON.stringify(payload), backupKey),
  };
}

/** Parses the v2 envelope without decrypting or changing local data. */
export function parseEncryptedBackup(text: string): EncryptedBackupEnvelope {
  if (text.length > MAX_BACKUP_CHARS) throw new Error('Backup file is too large.');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a valid .sc file.');
  }

  if (!isObject(raw) || raw.version !== ENCRYPTED_BACKUP_VERSION || !isObject(raw.keySlots)) {
    throw new Error('Unsupported encrypted .sc file version.');
  }
  const keySlots = raw.keySlots;
  if (!isString(keySlots.salt) || !/^[0-9a-f]{32}$/i.test(keySlots.salt)) throw new Error('Invalid key slot salt.');
  if (!isString(keySlots.wrappedMEKByPassword)) throw new Error('Invalid password key slot.');
  if (!isString(keySlots.wrappedMEKBySeed)) throw new Error('Invalid recovery key slot.');
  if (!isEncryptedJson(keySlots.wrappedMEKByPassword, 'wrappedKey')) throw new Error('Invalid password key slot.');
  if (!isEncryptedJson(keySlots.wrappedMEKBySeed, 'wrappedKey')) throw new Error('Invalid recovery key slot.');
  if (!isString(raw.backupSalt) || !/^[0-9a-f]{32}$/i.test(raw.backupSalt)) throw new Error('Invalid backup salt.');
  if (!isString(raw.ciphertext) || !isEncryptedJson(raw.ciphertext, 'ciphertext')) throw new Error('Invalid encrypted backup payload.');

  return {
    version: ENCRYPTED_BACKUP_VERSION,
    keySlots: {
      salt: keySlots.salt,
      wrappedMEKByPassword: keySlots.wrappedMEKByPassword,
      wrappedMEKBySeed: keySlots.wrappedMEKBySeed,
    },
    backupSalt: raw.backupSalt,
    ciphertext: raw.ciphertext,
  };
}

/** Opens a v2 envelope with either credential, then validates the plaintext payload before returning it. */
export async function decryptBackupPayload(
  envelope: EncryptedBackupEnvelope,
  secret: string,
  credential: BackupCredential,
): Promise<BackupPayload> {
  const wrappedMasterKey = credential === 'password'
    ? envelope.keySlots.wrappedMEKByPassword
    : envelope.keySlots.wrappedMEKBySeed;
  const masterKey = await unwrapMasterKey(wrappedMasterKey, secret, envelope.keySlots.salt);
  const backupKey = await deriveBackupKey(masterKey, envelope.backupSalt);
  const plaintext = await decryptData(envelope.ciphertext, backupKey);
  const payload = parseBackup(plaintext, true);

  if (
    payload.vaultConfig.salt !== envelope.keySlots.salt ||
    payload.vaultConfig.wrappedMEKByPassword !== envelope.keySlots.wrappedMEKByPassword ||
    payload.vaultConfig.wrappedMEKBySeed !== envelope.keySlots.wrappedMEKBySeed
  ) {
    throw new Error('Backup key slots do not match the encrypted payload.');
  }

  return payload;
}

/** Parses and validates a .sc file; copies only known fields so unexpected data is never stored. */
export function parseBackup(text: string, preserveUnknown = false): BackupPayload {
  if (text.length > MAX_BACKUP_CHARS) throw new Error('Backup file is too large.');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a valid .sc file.');
  }

  if (!isObject(raw) || raw.version !== BACKUP_VERSION) throw new Error('Unsupported .sc file version.');
  if (!Array.isArray(raw.entries)) throw new Error('Invalid .sc file structure.');
  if (raw.auditLogs !== undefined && !Array.isArray(raw.auditLogs)) throw new Error('Invalid .sc file structure.');

  return {
    ...unknownFields(raw, ['version', 'exportedAt', 'vaultConfig', 'entries', 'auditLogs'], preserveUnknown),
    version: BACKUP_VERSION,
    exportedAt: isTimestamp(raw.exportedAt) ? raw.exportedAt : 0,
    vaultConfig: readVaultConfig(raw.vaultConfig, preserveUnknown),
    entries: raw.entries.map((entry, index) => readEntry(entry, index, preserveUnknown)),
    auditLogs: (raw.auditLogs ?? []).map((log, index) => readAuditLog(log, index, preserveUnknown)),
  };
}
