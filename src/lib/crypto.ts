import { BIP39_WORDLIST } from './bip39Words';

/**
 * Generates 256 bits of entropy + 8 bits SHA-256 checksum = 264 bits (24 words)
 */
export async function generateBip39Seed(): Promise<string[]> {
  const entropy = new Uint8Array(32); // 256 bits
  window.crypto.getRandomValues(entropy);

  const hashBuffer = await window.crypto.subtle.digest('SHA-256', entropy);
  const hashArray = new Uint8Array(hashBuffer);
  const checksumByte = hashArray[0];

  let bits = '';
  for (let i = 0; i < entropy.length; i++) {
    bits += entropy[i].toString(2).padStart(8, '0');
  }
  bits += checksumByte.toString(2).padStart(8, '0');

  const words: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    const index = parseInt(bits.slice(i, i + 11), 2);
    words.push(BIP39_WORDLIST[index % BIP39_WORDLIST.length]);
  }

  return words;
}

/**
 * Validates a 24-word seed phrase against SHA-256 checksum
 */
export async function validateBip39Seed(words: string[]): Promise<boolean> {
  if (words.length !== 24) return false;

  let bits = '';
  for (const word of words) {
    const index = BIP39_WORDLIST.indexOf(word.trim().toLowerCase());
    if (index === -1) return false;
    bits += index.toString(2).padStart(11, '0');
  }

  const entropyBits = bits.slice(0, 256);
  const checksumBits = bits.slice(256);

  const entropy = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    entropy[i] = parseInt(entropyBits.slice(i * 8, (i + 1) * 8), 2);
  }

  const hashBuffer = await window.crypto.subtle.digest('SHA-256', entropy);
  const hashArray = new Uint8Array(hashBuffer);
  const expectedChecksumBits = hashArray[0].toString(2).padStart(8, '0');

  return checksumBits === expectedChecksumBits;
}

/** Copies a Uint8Array view into a standalone ArrayBuffer for WebCrypto. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// OWASP-recommended work factor for PBKDF2-HMAC-SHA256; WebCrypto has no memory-hard KDF.
const PBKDF2_ITERATIONS = 600_000;

/** Derives an AES-GCM wrapping key from a password or seed phrase via PBKDF2. */
async function deriveKeyFromSecret(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Creates the random master encryption key (MEK) that encrypts all entries. */
export async function generateMasterKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/** Encrypts the MEK under a secret so it can be stored; returns JSON {iv, wrappedKey}. */
export async function wrapMasterKey(masterKey: CryptoKey, secret: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const wrappingKey = await deriveKeyFromSecret(secret, salt);
  
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrappedBuffer = await window.crypto.subtle.wrapKey('raw', masterKey, wrappingKey, {
    name: 'AES-GCM',
    iv,
  });

  return JSON.stringify({
    iv: Array.from(iv),
    wrappedKey: Array.from(new Uint8Array(wrappedBuffer)),
  });
}

/** Reverses wrapMasterKey; throws OperationError when the secret is wrong. */
export async function unwrapMasterKey(wrappedPayload: string, secret: string, saltHex: string): Promise<CryptoKey> {
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const unwrappingKey = await deriveKeyFromSecret(secret, salt);
  const { iv, wrappedKey } = JSON.parse(wrappedPayload);

  return window.crypto.subtle.unwrapKey(
    'raw',
    new Uint8Array(wrappedKey),
    unwrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/** AES-256-GCM encrypts text with a fresh IV; returns JSON {iv, ciphertext}. */
export async function encryptData(plaintext: string, mek: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    mek,
    encoder.encode(plaintext)
  );

  return JSON.stringify({
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(encrypted)),
  });
}

/** Decrypts a payload produced by encryptData. */
export async function decryptData(payload: string, mek: CryptoKey): Promise<string> {
  const { iv, ciphertext } = JSON.parse(payload);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    mek,
    new Uint8Array(ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}

/** Random 16-byte PBKDF2 salt as hex. */
export function generateSaltHex(): string {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
}
