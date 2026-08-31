import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

type BrowserCrypto = Partial<
  Pick<Crypto, 'randomUUID' | 'getRandomValues'>
>;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatUuid(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/** Creates a UUID even when randomUUID is unavailable on a non-HTTPS origin. */
export function createUuid(cryptoSource: BrowserCrypto | undefined = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === 'function') {
    return cryptoSource.randomUUID.call(cryptoSource);
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoSource?.getRandomValues === 'function') {
    cryptoSource.getRandomValues.call(cryptoSource, bytes);
  } else {
    // This final fallback keeps the UI usable in old embedded browsers. These
    // IDs identify local records; they are not used as security credentials.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    const timestamp = Date.now();
    for (let index = 0; index < 6; index += 1) {
      bytes[index] ^= timestamp >>> ((index % 4) * 8);
    }
  }
  return formatUuid(bytes);
}
