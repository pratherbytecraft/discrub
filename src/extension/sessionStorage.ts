import type { StorageAdapter } from './storage';

/** Per-view storage for environments that cannot open IndexedDB. */
export function createSessionStorage(): StorageAdapter {
  const values = new Map<string, unknown>();
  const keys = () => [...values.keys()].sort();
  const get = <T>(key: string): T | null => structuredClone((values.get(key) ?? null) as T | null);

  return {
    async get<T>(key: string) {
      return get<T>(key);
    },
    async set<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async remove(key: string) {
      values.delete(key);
    },
    async clear() {
      values.clear();
    },
    async keys() {
      return keys();
    },
    async getMany<T>(requested: string[]) {
      return requested.map((key) => get<T>(key));
    },
    async setMany<T>(entries: Array<[string, T]>) {
      // Clone the whole batch before writing, matching IDB transaction atomicity.
      const cloned = structuredClone(entries);
      for (const [key, value] of cloned) values.set(key, value);
    },
    async entries<T>() {
      return keys().map((key): [string, T] => [key, structuredClone(values.get(key) as T)]);
    },
  };
}
