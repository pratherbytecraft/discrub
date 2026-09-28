import { useEffect, useRef, useState } from 'react';

/**
 * 2.2.2: hands a fast changing value to the screen at most once per `ms`.
 * A change of `key` goes through at once, so a state change (paused, rest
 * break, finished) is never late; only the numbers in between are spaced
 * out. The last value always lands.
 */
export const useSteadyValue = <T,>(value: T, key: string, ms: number): T => {
  const [shown, setShown] = useState({ value, key });
  const latest = useRef(value); latest.current = value;
  const lastAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const show = () => { lastAt.current = Date.now(); timer.current = null; setShown({ value: latest.current, key }); };
    if (key !== shown.key || now - lastAt.current >= ms) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      show();
    } else if (!timer.current) {
      timer.current = setTimeout(show, ms - (now - lastAt.current));
    }
  // `shown.key` is read, not watched: the effect runs on every new value or key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key, ms]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // A new key shows its own value in the same render, before the effect catches up.
  return key !== shown.key ? value : shown.value;
};
