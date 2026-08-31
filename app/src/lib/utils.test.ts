import { describe, expect, it, vi } from 'vitest';
import { cn, createUuid } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind classes and ignores falsy values', () => {
    expect(cn('px-2', false, 'px-4', undefined, 'text-sm')).toBe('px-4 text-sm');
  });
});

describe('createUuid', () => {
  it('uses the native randomUUID implementation when available', () => {
    const uuid =
      '123e4567-e89b-42d3-a456-426614174000' as ReturnType<Crypto['randomUUID']>;
    const randomUUID = vi.fn(() => uuid);

    expect(createUuid({ randomUUID })).toBe(uuid);
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('creates an RFC 4122 v4 UUID with getRandomValues on insecure origins', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    }) as unknown as Crypto['getRandomValues'];

    const uuid = createUuid({ getRandomValues });

    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('keeps generating valid IDs when Web Crypto methods are absent', () => {
    expect(createUuid({})).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
