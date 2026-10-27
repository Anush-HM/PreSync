import { useEffect, useState } from 'react';

function matches(query) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

// Tracks a CSS media query. Falls back to `false` where matchMedia is
// missing (jsdom), which means "desktop" for the queries used here.
export function useMediaQuery(query) {
  const [value, setValue] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setValue(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);

  return value;
}
