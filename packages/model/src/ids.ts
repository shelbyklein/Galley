import { z } from 'zod';

/** Every object in a document (page, layer, frame, story, swatch, asset, guide) is addressed by an opaque string id. */
export type Id = string;

/** Letters, digits and `_ . : -`; 1 to 64 characters; starts with a letter or digit. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export const idSchema = z.string().regex(ID_PATTERN, 'not a valid id');

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A fresh random id such as `frm_k3x9a0qz4f`: a readable prefix plus 10 random base-36 characters (about 52 bits,
 * so collisions are not a practical concern for one document). Commands never generate ids themselves; the caller
 * passes them in, which keeps commands deterministic and lets tests use `createSequentialIds`.
 */
export function createId(prefix = 'id'): Id {
  const crypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  const bytes = new Uint8Array(10);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Predictable ids for tests and fixtures: `frm_1`, `frm_2`, ... per prefix. */
export function createSequentialIds(): (prefix?: string) => Id {
  const counters = new Map<string, number>();
  return (prefix = 'id') => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${n}`;
  };
}
