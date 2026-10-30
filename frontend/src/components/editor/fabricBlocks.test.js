import { describe, expect, it } from 'vitest';
import { fabricTextAlign, textboxProps } from './fabricBlocks.js';

describe('justified text', () => {
  it('maps to the Fabric alignment that leaves last lines alone', () => {
    expect(fabricTextAlign('justify')).toBe('justify-left');
    expect(fabricTextAlign('right')).toBe('right');
    expect(fabricTextAlign(undefined)).toBe('left');
    expect(textboxProps({ textAlign: 'justify', text: 'a' }, 1).textAlign).toBe('justify-left');
  });
});
