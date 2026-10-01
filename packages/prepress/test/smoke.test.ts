import { describe, expect, it } from 'vitest';
import { PREPRESS_STUB } from '../src';

describe('@galley/prepress', () => {
  it('is an empty stub until lane A (P1-05) ports the spike', () => {
    expect(PREPRESS_STUB).toBe(true);
  });
});
