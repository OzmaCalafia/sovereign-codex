import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptData,
  encryptData,
  generateBip39Seed,
  generateMasterKey,
  generateSaltHex,
  unwrapMasterKey,
  validateBip39Seed,
  wrapMasterKey,
} from './crypto';

// crypto.ts reads window.crypto; Node exposes the same API on globalThis.
beforeAll(() => {
  (globalThis as { window?: unknown }).window = globalThis;
});

describe('recovery phrase', () => {
  it('generates 24 words that pass validation', async () => {
    const seed = await generateBip39Seed();
    expect(seed).toHaveLength(24);
    expect(await validateBip39Seed(seed)).toBe(true);
  });

  it('rejects wrong length and unknown words', async () => {
    const seed = await generateBip39Seed();
    expect(await validateBip39Seed(seed.slice(0, 23))).toBe(false);
    expect(await validateBip39Seed([...seed.slice(0, 23), 'notaword'])).toBe(false);
  });

  it('catches most single-word changes through the checksum', async () => {
    const seed = await generateBip39Seed();
    const others = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract'].filter((w) => w !== seed[0]);
    const results = await Promise.all(others.map((word) => validateBip39Seed([word, ...seed.slice(1)])));
    expect(results.filter(Boolean).length).toBeLessThan(others.length);
  });

  it('never repeats a phrase', async () => {
    expect((await generateBip39Seed()).join(' ')).not.toBe((await generateBip39Seed()).join(' '));
  });
});

describe('entry encryption', () => {
  it('round-trips text, including non-ASCII', async () => {
    const key = await generateMasterKey();
    const text = 'Catalyst — Friction → Parameter ✓ [SC]';
    expect(await decryptData(await encryptData(text, key), key)).toBe(text);
  });

  it('uses a fresh IV so equal text encrypts differently', async () => {
    const key = await generateMasterKey();
    expect(await encryptData('same', key)).not.toBe(await encryptData('same', key));
  });

  it('refuses to decrypt with a different key or tampered data', async () => {
    const key = await generateMasterKey();
    const payload = await encryptData('secret', key);
    await expect(decryptData(payload, await generateMasterKey())).rejects.toThrow();

    const parsed = JSON.parse(payload) as { iv: number[]; ciphertext: number[] };
    parsed.ciphertext[0] ^= 1;
    await expect(decryptData(JSON.stringify(parsed), key)).rejects.toThrow();
  });
});

describe('master key wrapping', () => {
  it('opens with the right password and decrypts earlier entries', async () => {
    const mek = await generateMasterKey();
    const salt = generateSaltHex();
    const entry = await encryptData('kept safe', mek);
    const wrapped = await wrapMasterKey(mek, 'correct horse battery', salt);

    const restored = await unwrapMasterKey(wrapped, 'correct horse battery', salt);
    expect(await decryptData(entry, restored)).toBe('kept safe');
  });

  it('rejects a wrong password', async () => {
    const mek = await generateMasterKey();
    const salt = generateSaltHex();
    const wrapped = await wrapMasterKey(mek, 'right-password', salt);
    await expect(unwrapMasterKey(wrapped, 'wrong-password', salt)).rejects.toThrow();
  });

  it('opens the same key with the recovery phrase, independent of the password', async () => {
    const mek = await generateMasterKey();
    const salt = generateSaltHex();
    const seed = (await generateBip39Seed()).join(' ');
    const entry = await encryptData('via seed', mek);
    const bySeed = await wrapMasterKey(mek, seed, salt);

    await wrapMasterKey(mek, 'password-one', salt);
    const restored = await unwrapMasterKey(bySeed, seed, salt);
    expect(await decryptData(entry, restored)).toBe('via seed');
  });
});

describe('salt', () => {
  it('is 16 random bytes as hex', () => {
    const salt = generateSaltHex();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSaltHex()).not.toBe(salt);
  });
});
