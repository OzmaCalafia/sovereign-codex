import Dexie, { type Table } from 'dexie';

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

export interface VaultConfig {
  id?: number;
  salt: string;
  wrappedMEKByPassword: string; // MEK encrypted via Main Password
  wrappedMEKBySeed: string;     // MEK encrypted via 24-Word Seed Phrase
  encryptedSignature?: string;
  createdAt: number;
}

export interface AuditLog {
  id?: number;
  action: string;
  details: string;
  timestamp: number;
}

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

export async function wipeLocalVault(): Promise<void> {
  await db.transaction('rw', [db.entries, db.vaultConfig, db.auditLogs], async () => {
    await db.entries.clear();
    await db.vaultConfig.clear();
    await db.auditLogs.clear();
  });
}
