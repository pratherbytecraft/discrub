import { describe, expect, it } from 'vitest';
import { createSessionStorage } from './sessionStorage';

describe('session storage', () => {
  it('clones writes and reads, including structured values', async () => {
    const storage = createSessionStorage();
    const value = { items: [1], date: new Date(0), map: new Map([['key', 1]]), bytes: new Uint8Array([1, 2]) };
    await storage.set('value', value);
    value.items.push(2);
    value.map.set('key', 2);
    value.bytes[0] = 9;
    const read = await storage.get<typeof value>('value');
    expect(read!.items).toEqual([1]);
    expect(read!.date.getTime()).toBe(0);
    expect([...read!.map]).toEqual([['key', 1]]);
    expect(Array.from(read!.bytes)).toEqual([1, 2]);
    read!.items.push(3);
    expect((await storage.get<typeof value>('value'))!.items).toEqual([1]);
  });

  it('keeps stores isolated and supports deletion and clear', async () => {
    const first = createSessionStorage();
    const second = createSessionStorage();
    await first.set('key', 'first');
    await second.set('key', 'second');
    await first.remove('key');
    expect(await first.get('key')).toBeNull();
    expect(await second.get('key')).toBe('second');
    await first.set('another', true);
    await first.clear();
    expect(await first.entries()).toEqual([]);
  });

  it('preserves read order and IDB key ordering', async () => {
    const storage = createSessionStorage();
    await storage.setMany([['z', 1], ['a', 2], ['z', 3]]);
    expect(await storage.getMany(['z', 'missing', 'a'])).toEqual([3, null, 2]);
    expect(await storage.keys()).toEqual(['a', 'z']);
    expect(await storage.entries()).toEqual([['a', 2], ['z', 3]]);
  });

  it('does not partially apply a batch that cannot be cloned', async () => {
    const storage = createSessionStorage();
    await expect(storage.setMany<unknown>([['valid', 1], ['invalid', () => 2]])).rejects.toThrow();
    expect(await storage.keys()).toEqual([]);
  });

  it('keeps undefined entry values while missing reads return null', async () => {
    const storage = createSessionStorage();
    await storage.set('undefined', undefined);
    expect(await storage.get('undefined')).toBeNull();
    expect(await storage.entries()).toEqual([['undefined', undefined]]);
  });
});
