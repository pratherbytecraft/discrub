import { useSyncExternalStore } from 'react';

/**
 * How many characters the mounted stage can hold right now, or null while no
 * stage is mounted. The Appearance menu reads it to say "1 shows on this screen".
 */
let slots: number | null = null;
const listeners = new Set<() => void>();

export const setStageSlots = (value: number | null): void => {
  if (slots === value) return;
  slots = value;
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => slots;

export const useStageSlots = (): number | null => useSyncExternalStore(subscribe, get, get);
