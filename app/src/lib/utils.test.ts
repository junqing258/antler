import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind classes and ignores falsy values', () => {
    expect(cn('px-2', false, 'px-4', undefined, 'text-sm')).toBe('px-4 text-sm');
  });
});
