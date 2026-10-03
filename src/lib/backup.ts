// Strict validation of .sc backup files before anything touches the local database.
import type { AuditLog, EntryRecord, VaultConfig } from '../db/database';

export const BACKUP_VERSION = 1;
const MAX_BACKUP_CHARS = 50_000_000;

export interface BackupPayload {
  version: number;
  exportedAt: number;
  vaultConfig: VaultConfig;
  entries: EntryRecord[];
  auditLogs: AuditLog[];
}

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

function readVaultConfig(raw: unknown): VaultConfig {
  if (!isObject(raw)) throw new Error('Missing [SC] key data.');
  if (!isString(raw.salt) || !/^[0-9a-f]{32}$/i.test(raw.salt)) throw new Error('Invalid salt.');
  if (!isEncryptedJson(raw.wrappedMEKByPassword, 'wrappedKey')) throw new Error('Invalid password key.');
  if (!isEncryptedJson(raw.wrappedMEKBySeed, 'wrappedKey')) throw new Error('Invalid recovery key.');
  if (raw.encryptedSignature !== undefined && !isEncryptedJson(raw.encryptedSignature, 'ciphertext')) throw new Error('Invalid signature.');
  if (!isTimestamp(raw.createdAt)) throw new Error('Invalid creation date.');

  return {
    salt: raw.salt,
    wrappedMEKByPassword: raw.wrappedMEKByPassword as string,
    wrappedMEKBySeed: raw.wrappedMEKBySeed as string,
    ...(raw.encryptedSignature !== undefined && { encryptedSignature: raw.encryptedSignature as string }),
    createdAt: raw.createdAt,
  };
}

function readEntry(raw: unknown, position: number): EntryRecord {
  const label = `Entry ${position + 1}`;
  if (!isObject(raw)) throw new Error(`${label} is malformed.`);
  if (!isString(raw.title) || !isString(raw.category)) throw new Error(`${label} has an invalid title.`);
  if (!Array.isArray(raw.tags) || !raw.tags.every(isString)) throw new Error(`${label} has invalid tags.`);
  if (raw.isEncrypted !== true || !isEncryptedJson(raw.content, 'ciphertext')) throw new Error(`${label} is not a valid encrypted entry.`);
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) throw new Error(`${label} has an invalid date.`);

  return {
    title: raw.title,
    category: raw.category,
    tags: raw.tags as string[],
    isEncrypted: true,
    content: raw.content as string,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function readAuditLog(raw: unknown, position: number): AuditLog {
  if (!isObject(raw) || !isString(raw.action) || !isString(raw.details) || !isTimestamp(raw.timestamp)) {
    throw new Error(`Log ${position + 1} is malformed.`);
  }
  return { action: raw.action, details: raw.details, timestamp: raw.timestamp };
}

/** Parses and validates a .sc file; copies only known fields so unexpected data is never stored. */
export function parseBackup(text: string): BackupPayload {
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
    version: BACKUP_VERSION,
    exportedAt: isTimestamp(raw.exportedAt) ? raw.exportedAt : 0,
    vaultConfig: readVaultConfig(raw.vaultConfig),
    entries: raw.entries.map(readEntry),
    auditLogs: (raw.auditLogs ?? []).map(readAuditLog),
  };
}
