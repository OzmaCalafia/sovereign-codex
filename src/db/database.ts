// Local IndexedDB schema (Dexie). Nothing leaves the browser.
import Dexie, { type Table } from 'dexie';

/** One saved entry; `content` is ciphertext, title/category/tags stay readable for indexing. */
export interface EntryRecord {
  id?: number;
  title: string;
  category: string;
  tags: string[];
  isEncrypted: boolean;
  content: string; // Serialized AES-256-GCM encrypted payload
  createdAt: number;
  updatedAt: number;
}

/** Single row holding the wrapped keys and salt for this [SC]. */
export interface VaultConfig {
  id?: number;
  salt: string;
  wrappedMEKByPassword: string; // MEK encrypted via Main Password
  wrappedMEKBySeed: string;     // MEK encrypted via 24-Word Seed Phrase
  encryptedSignature?: string;
  createdAt: number;
}

/** Reserved log table; not written yet but kept so existing .sc backups stay compatible. */
export interface AuditLog {
  id?: number;
  action: string;
  details: string;
  timestamp: number;
}

/** Dexie database with typed tables. */
export class SovereignCodexDB extends Dexie {
  entries!: Table<EntryRecord, number>;
  vaultConfig!: Table<VaultConfig, number>;
  auditLogs!: Table<AuditLog, number>;

  constructor() {
    super('SovereignCodexDB');

    // Define table schemas and indexed fields for high-speed offline queries
    this.version(1).stores({
      entries: '++id, title, category, *tags, isEncrypted, createdAt, updatedAt',
      vaultConfig: '++id',
      auditLogs: '++id, action, timestamp',
    });
  }
}

export const db = new SovereignCodexDB();

/** Deletes every table's rows in one transaction. */
export async function wipeLocalVault(): Promise<void> {
  await db.transaction('rw', [db.entries, db.vaultConfig, db.auditLogs], async () => {
    await db.entries.clear();
    await db.vaultConfig.clear();
    await db.auditLogs.clear();
  });
}
