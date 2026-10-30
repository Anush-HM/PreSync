import { describe, expect, it } from 'vitest';
import { legacyFitScale } from './slideFormat.js';

describe('legacyFitScale', () => {
  it('leaves boxes that only run past the edge alone', () => {
    expect(legacyFitScale([{ x: 80, y: 500, width: 950, fontSize: 40 }])).toBe(1);
  });

  it('respects the deck size', () => {
    expect(legacyFitScale([{ x: 80, y: 650, width: 300, fontSize: 18 }], 960, 720)).toBe(1);
  });

  it('still fits blocks that start outside the canvas', () => {
    const s = legacyFitScale([{ x: 1000, y: 10, width: 200, fontSize: 18 }]);
    expect(s).toBeCloseTo(940 / 1200);
  });
});
