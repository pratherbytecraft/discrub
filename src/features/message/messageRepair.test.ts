/**
 * Row 124 (pass 2): a damaged stored row is put back to a shape the app
 * can show, on the way out of the store.
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Message } from 'discrub-core/types/discord-types';
import { createMockMessage } from '@/test/fixtures';
import { repairMessage, repairRow, UNKNOWN_AUTHOR } from './messageRepair';
import { toMessageRow } from './messageRows';
import { createWorkspace, deleteWorkspaceDatabase, getMessages, openWorkspaceDatabase, padSnowflake, readWindow, writePage } from '@services/workspaceStore';

const damaged = (): Message => ({
  ...createMockMessage({ id: '1148080200000000000', channel_id: '100' }),
  attachments: 'x' as never,
  embeds: 7 as never,
  author: null as never,
  timestamp: 'not a date',
});

describe('repairMessage', () => {
  it('returns a sound message as it is', () => {
    const message = createMockMessage({ id: '1' });
    expect(repairMessage(message)).toBe(message);
  });

  it('puts lists, the author and the timestamp back to shapes the feed can use', () => {
    const fixed = repairMessage(damaged());
    expect(fixed.attachments).toEqual([]);
    expect(fixed.embeds).toEqual([]);
    expect(fixed.author).toEqual(UNKNOWN_AUTHOR);
    expect(Number.isNaN(Date.parse(fixed.timestamp))).toBe(false);
    // The time comes from the snowflake, so the row keeps its place in the day.
    expect(fixed.timestamp.startsWith('2023-09-0')).toBe(true);
    expect(fixed.content).toBe('Test message');
  });

  describe('repairRow (pass 3, row 153)', () => {
    it('returns a sound row as it is', () => {
      const row = toMessageRow(createMockMessage({ id: '1148080200000000000' }));
      expect(repairRow(row)).toBe(row);
    });

    it('takes the time of a row whose timestamp is not a date from the snowflake', () => {
      const row = { ...toMessageRow(createMockMessage({ id: '1148080200000000000' })), timestamp: 'not a date', t: NaN };
      const fixed = repairRow(row);
      expect(fixed.timestamp.startsWith('2023-09-0')).toBe(true);
      expect(fixed.t).toBe(Date.parse(fixed.timestamp));
    });
  });

  describe('on the way out of the store', () => {
    beforeEach(async () => {
      await deleteWorkspaceDatabase();
      await ensureTestDefaultWorkspace();
    });
    afterEach(async () => {
      await deleteWorkspaceDatabase();
    });

    it('a damaged row is repaired on the way in', async () => {
      const ws = await createWorkspace({ name: 'Damaged' });
      await writePage(ws.wid, '100', [damaged()], { kind: 'channel', guildId: '42', name: 'general' });
      const [stored] = await readWindow(ws.wid, '100', { limit: 1 });
      expect(stored.attachments).toEqual([]);
      expect(stored.author).toEqual(UNKNOWN_AUTHOR);
    });

    it('readWindow and getMessages repair a row an older build left damaged', async () => {
      const ws = await createWorkspace({ name: 'Damaged' });
      const sound = createMockMessage({ id: '1148080200000000000', channel_id: '100' });
      await writePage(ws.wid, '100', [sound], { kind: 'channel', guildId: '42', name: 'general' });
      // Damage the stored row underneath the store, the way the VM pass did.
      const db = await openWorkspaceDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('rows', 'readwrite');
        const rows = tx.objectStore('rows');
        const key = [ws.wid, '100', padSnowflake(sound.id)];
        const get = rows.get(key);
        get.onsuccess = () => {
          rows.put({ ...get.result, message: damaged() });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      const [fromWindow] = await readWindow(ws.wid, '100', { limit: 1 });
      expect(fromWindow.attachments).toEqual([]);
      expect(fromWindow.author).toEqual(UNKNOWN_AUTHOR);
      const [byId] = await getMessages(ws.wid, '100', ['1148080200000000000']);
      expect(byId?.embeds).toEqual([]);
    });
  });
});
