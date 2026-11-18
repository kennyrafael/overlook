import { useEffect, useRef } from 'react';

/** Calls `fn` whenever `value` changes after the first render. */
export function useOnChange<T>(value: T, fn: () => void) {
  const first = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    fnRef.current();
  }, [value]);
}
