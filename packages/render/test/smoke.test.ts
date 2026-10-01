import { describe, expect, it } from 'vitest';
import * as render from '../src';

describe('@galley/render', () => {
  it('loads', () => {
    expect(render).toBeDefined();
  });
});
