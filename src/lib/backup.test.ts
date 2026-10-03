import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, parseBackup } from './backup';

const encrypted = JSON.stringify({ iv: Array(12).fill(1), ciphertext: [1, 2, 3] });
const wrapped = JSON.stringify({ iv: Array(12).fill(1), wrappedKey: [1, 2, 3] });

const valid = {
  version: BACKUP_VERSION,
  exportedAt: 1,
  vaultConfig: { salt: 'a'.repeat(32), wrappedMEKByPassword: wrapped, wrappedMEKBySeed: wrapped, createdAt: 1 },
  entries: [{ title: 't', category: 'c', tags: ['x'], isEncrypted: true, content: encrypted, createdAt: 1, updatedAt: 1 }],
  auditLogs: [],
};

const parse = (value: unknown) => parseBackup(JSON.stringify(value));

describe('parseBackup', () => {
  it('accepts a well-formed backup', () => {
    const result = parse(valid);
    expect(result.entries).toHaveLength(1);
    expect(result.vaultConfig.salt).toBe('a'.repeat(32));
  });

  it('accepts a backup with a signature and logs', () => {
    const result = parse({
      ...valid,
      vaultConfig: { ...valid.vaultConfig, encryptedSignature: encrypted },
      auditLogs: [{ action: 'a', details: 'd', timestamp: 1 }],
    });
    expect(result.vaultConfig.encryptedSignature).toBe(encrypted);
    expect(result.auditLogs).toHaveLength(1);
  });

  it('drops fields it does not recognize', () => {
    const result = parse({ ...valid, extra: 1, entries: [{ ...valid.entries[0], id: 99, injected: '<b>' }] });
    expect(result.entries[0]).not.toHaveProperty('injected');
    expect(result).not.toHaveProperty('extra');
  });

  it.each([
    ['not JSON', '{oops'],
    ['wrong version', JSON.stringify({ ...valid, version: 2 })],
    ['missing key data', JSON.stringify({ ...valid, vaultConfig: undefined })],
    ['non-hex salt', JSON.stringify({ ...valid, vaultConfig: { ...valid.vaultConfig, salt: 'zz' } })],
    ['wrapped key with short IV', JSON.stringify({ ...valid, vaultConfig: { ...valid.vaultConfig, wrappedMEKBySeed: JSON.stringify({ iv: [1], wrappedKey: [1] }) } })],
    ['entries not an array', JSON.stringify({ ...valid, entries: 'x' })],
    ['plaintext entry', JSON.stringify({ ...valid, entries: [{ ...valid.entries[0], isEncrypted: false }] })],
    ['entry bytes out of range', JSON.stringify({ ...valid, entries: [{ ...valid.entries[0], content: JSON.stringify({ iv: Array(12).fill(1), ciphertext: [300] }) }] })],
    ['entry with bad tags', JSON.stringify({ ...valid, entries: [{ ...valid.entries[0], tags: [1] }] })],
    ['malformed log', JSON.stringify({ ...valid, auditLogs: [{ action: 1 }] })],
  ])('rejects %s', (_label, text) => {
    expect(() => parseBackup(text)).toThrow();
  });
});
