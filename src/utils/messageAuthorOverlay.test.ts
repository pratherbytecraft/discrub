import { describe, it, expect } from 'vitest';
import { overlayMessageAuthors, sameAuthorEntries, sameEntriesByRef } from './messageAuthorOverlay';
import { createMockMessage, createMockUser } from '../test/fixtures';

const msgFrom = (id: string, username: string, global_name: string | null) =>
  createMockMessage({ id: `m-${id}-${username}`, author: createMockUser({ id, username, global_name }) });

describe('overlayMessageAuthors (#263)', () => {
  it('adds an author that is not in the map', () => {
    const map = overlayMessageAuthors({}, [msgFrom('u1', 'alice', 'Alice A')]);
    expect(map.u1).toEqual({ userName: 'alice', displayName: 'Alice A' });
  });

  it('keeps a cached nickname when the author is overlaid', () => {
    const map = overlayMessageAuthors({ u1: { nick: 'Ali' } }, [msgFrom('u1', 'alice', 'Alice A')]);
    expect(map.u1).toEqual({ nick: 'Ali', userName: 'alice', displayName: 'Alice A' });
  });

  it('leaves an unchanged author entry as the same object', () => {
    const entry = { userName: 'alice', displayName: 'Alice A' };
    const map = overlayMessageAuthors({ u1: entry }, [msgFrom('u1', 'alice', 'Alice A')]);
    expect(map.u1).toBe(entry);
  });

  it('replaces the entry when the username changes', () => {
    const map = overlayMessageAuthors(
      { u1: { userName: 'alice', displayName: 'Alice A' } },
      [msgFrom('u1', 'alice_new', 'Alice A')],
    );
    expect(map.u1).toEqual({ userName: 'alice_new', displayName: 'Alice A' });
  });

  it('replaces the entry when a later message carries a new global name', () => {
    const map = overlayMessageAuthors({}, [msgFrom('u1', 'alice', 'Alice A'), msgFrom('u1', 'alice', 'Alice B')]);
    expect(map.u1.displayName).toBe('Alice B');
  });

  it('keeps the known display name when a message has no global name', () => {
    const map = overlayMessageAuthors(
      { u1: { userName: 'alice', displayName: 'Alice A' } },
      [msgFrom('u1', 'alice', null)],
    );
    expect(map.u1.displayName).toBe('Alice A');
  });

  it('skips messages without an author', () => {
    const map = overlayMessageAuthors({}, [createMockMessage({ author: undefined as any })]);
    expect(map).toEqual({});
  });
});

describe('sameAuthorEntries and sameEntriesByRef (2.2.1 perf)', () => {
  it('treats maps with the same ids and name fields as the same', () => {
    expect(sameAuthorEntries({ u1: { userName: 'a', displayName: 'A' } }, { u1: { userName: 'a', displayName: 'A' } })).toBe(true);
    expect(sameAuthorEntries({ u1: { userName: 'a' } }, { u1: { userName: 'a', nick: 'n' } })).toBe(false);
    expect(sameAuthorEntries({ u1: { userName: 'a' } }, { u1: { userName: 'a' }, u2: { userName: 'b' } })).toBe(false);
    expect(sameAuthorEntries({ u1: { userName: 'a' } }, { u2: { userName: 'a' } })).toBe(false);
  });

  it('compares entries by reference', () => {
    const u = createMockUser({ id: 'u1' });
    expect(sameEntriesByRef({ u1: u }, { u1: u })).toBe(true);
    expect(sameEntriesByRef({ u1: u }, { u1: { ...u } })).toBe(false);
    expect(sameEntriesByRef({}, { u1: u })).toBe(false);
  });
});
