import { describe, expect, it } from 'vitest';
import { formatBytes, greetingFor, plural, timeAgo } from './format.js';

describe('timeAgo', () => {
  const now = new Date('2026-05-10T12:00:00Z').getTime();

  it('says "just now" for the last few seconds', () => {
    expect(timeAgo('2026-05-10T11:59:40Z', now)).toBe('just now');
  });

  it('uses the largest whole unit', () => {
    expect(timeAgo('2026-05-10T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(timeAgo('2026-05-03T12:00:00Z', now)).toMatch(/last week|1 week ago/);
  });

  it('handles missing or bad dates', () => {
    expect(timeAgo(null, now)).toBe('—');
    expect(timeAgo('not a date', now)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('plural / greetingFor', () => {
  it('pluralises', () => {
    expect(plural(1, 'slide')).toBe('1 slide');
    expect(plural(3, 'slide')).toBe('3 slides');
  });

  it('greets by time of day', () => {
    expect(greetingFor(new Date(2026, 0, 1, 9))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 0, 1, 14))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 0, 1, 21))).toBe('Good evening');
  });
});
