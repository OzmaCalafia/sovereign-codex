import { beforeAll, describe, expect, it } from 'vitest';
import { BACKUP_VERSION, decryptBackupPayload, encryptBackupPayload, parseBackup, parseEncryptedBackup } from './backup';
import { generateBip39Seed, generateMasterKey, generateSaltHex, wrapMasterKey } from './crypto';

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

beforeAll(() => {
  (globalThis as { window?: unknown }).window = globalThis;
});

async function createEncryptedFixture() {
  const masterKey = await generateMasterKey();
  const recoveryPhrase = (await generateBip39Seed()).join(' ');
  const salt = generateSaltHex();
  const password = 'backup-test-password';
  const vaultConfig = {
    salt,
    wrappedMEKByPassword: await wrapMasterKey(masterKey, password, salt),
    wrappedMEKBySeed: await wrapMasterKey(masterKey, recoveryPhrase, salt),
    createdAt: 1,
  };
  const payload = {
    ...valid,
    exportedAt: 1712345678901,
    vaultConfig: { ...vaultConfig, createdAt: 1712345678902 },
    entries: [{ ...valid.entries[0], title: 'PRIVATE-METADATA-CHECK' }],
  };
  const envelope = await encryptBackupPayload(payload, vaultConfig, masterKey);

  return { payload, envelope, password, recoveryPhrase, masterKey };
}

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

describe('encrypted backup envelope', () => {
  it('encrypts payload metadata and restores through either credential', async () => {
    const fixture = await createEncryptedFixture();
    const serialized = JSON.stringify(fixture.envelope);
    const outer = JSON.parse(serialized) as Record<string, unknown>;

    expect(outer).not.toHaveProperty('entries');
    expect(outer).not.toHaveProperty('exportedAt');
    expect(serialized).not.toContain('PRIVATE-METADATA-CHECK');
    expect(serialized).not.toContain('1712345678901');

    const parsed = parseEncryptedBackup(serialized);
    await expect(decryptBackupPayload(parsed, fixture.password, 'password')).resolves.toMatchObject({
      entries: fixture.payload.entries,
      vaultConfig: fixture.payload.vaultConfig,
    });
    await expect(decryptBackupPayload(parsed, fixture.recoveryPhrase, 'recoveryPhrase')).resolves.toMatchObject({
      entries: fixture.payload.entries,
      vaultConfig: fixture.payload.vaultConfig,
    });
  });

  it('rejects wrong credentials and modified ciphertext', async () => {
    const fixture = await createEncryptedFixture();
    await expect(decryptBackupPayload(fixture.envelope, 'wrong-password', 'password')).rejects.toThrow();

    const ciphertext = JSON.parse(fixture.envelope.ciphertext) as { iv: number[]; ciphertext: number[] };
    ciphertext.ciphertext[0] ^= 1;
    const tampered = { ...fixture.envelope, ciphertext: JSON.stringify(ciphertext) };
    await expect(decryptBackupPayload(tampered, fixture.password, 'password')).rejects.toThrow();
  });

  it('rejects credential slots that differ from the encrypted vault config', async () => {
    const fixture = await createEncryptedFixture();
    const mismatchedPasswordSlot = await wrapMasterKey(
      fixture.masterKey,
      fixture.password,
      fixture.payload.vaultConfig.salt,
    );
    const inconsistentPayload = {
      ...fixture.payload,
      vaultConfig: { ...fixture.payload.vaultConfig, wrappedMEKByPassword: mismatchedPasswordSlot },
    };
    const envelope = await encryptBackupPayload(inconsistentPayload, fixture.envelope.keySlots, fixture.masterKey);

    await expect(decryptBackupPayload(envelope, fixture.password, 'password')).rejects.toThrow(
      'Backup key slots do not match the encrypted payload.'
    );
  });

  it('preserves unknown optional payload fields without carrying local row IDs', async () => {
    const fixture = await createEncryptedFixture();
    const extendedPayload = {
      ...fixture.payload,
      futurePayloadField: { retained: true },
      vaultConfig: { ...fixture.payload.vaultConfig, futureConfigField: 'kept' },
      entries: [{ ...fixture.payload.entries[0], id: 912, futureEntryField: ['kept'] }],
      auditLogs: [{ id: 913, action: 'test', details: 'log', timestamp: 1, futureLogField: 7 }],
    };
    const envelope = await encryptBackupPayload(extendedPayload, fixture.envelope.keySlots, fixture.masterKey);
    const restored = await decryptBackupPayload(envelope, fixture.password, 'password');

    expect(restored).toHaveProperty('futurePayloadField', { retained: true });
    expect(restored.vaultConfig).toHaveProperty('futureConfigField', 'kept');
    expect(restored.entries[0]).toHaveProperty('futureEntryField', ['kept']);
    expect(restored.entries[0]).not.toHaveProperty('id');
    expect(restored.auditLogs[0]).toHaveProperty('futureLogField', 7);
    expect(restored.auditLogs[0]).not.toHaveProperty('id');
  });

  it('rejects malformed or unsupported envelope headers', () => {
    expect(() => parseEncryptedBackup('not-json')).toThrow();
    expect(() => parseEncryptedBackup(JSON.stringify({ version: 3 }))).toThrow();
    expect(() => parseEncryptedBackup(JSON.stringify({ ...valid, version: 2 }))).toThrow();
  });
});
