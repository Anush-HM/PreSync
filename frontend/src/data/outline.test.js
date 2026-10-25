import { describe, expect, it } from 'vitest';
import { bulletsToText, textToBullets } from './outline.js';

describe('outline bullet text', () => {
  it('round-trips bullets with indentation', () => {
    const bullets = [{ text: 'Top', level: 0 }, { text: 'Nested', level: 1 }, { text: 'Deep', level: 2 }];
    expect(textToBullets(bulletsToText(bullets))).toEqual(bullets);
  });

  it('drops blank lines, strips bullet characters and caps depth at two', () => {
    expect(textToBullets('• One\n\n      - Too deep\n  * Two')).toEqual([
      { text: 'One', level: 0 },
      { text: 'Too deep', level: 2 },
      { text: 'Two', level: 1 }
    ]);
  });
});
