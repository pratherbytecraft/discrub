import { describe, it, expect } from 'vitest';
import { newConversation, newWorkspaceRecord } from '@services/workspaceStore';
import { copyName, nextWorkspaceColor, nextWorkspaceName, summarizeWorkspace, WORKSPACE_COLORS } from './workspaceSummary';

function record() {
  const r = newWorkspaceRecord({ wid: 'w1', name: 'Raid archive' });
  const general = { ...newConversation('1', { kind: 'channel', guildId: 'g', name: 'general' }), count: 300, bytes: 3000 };
  const raids = { ...newConversation('2', { kind: 'channel', guildId: 'g', name: 'raids' }), count: 500, bytes: 5000 };
  const empty = newConversation('3', { kind: 'dm', guildId: null, name: 'Sam' });
  r.conversations = { '1': general, '2': raids, '3': empty };
  r.bytes = 8000;
  return r;
}

describe('workspace summaries (2.2.5 WP5)', () => {
  it('lists conversations with messages, largest first, and totals them', () => {
    const s = summarizeWorkspace(record());
    expect(s.conversations.map((c) => c.cid)).toEqual(['2', '1']);
    expect(s.count).toBe(800);
    expect(s.conversationCount).toBe(2);
    expect(s.work).toBeNull();
    expect(s.openable).toBe(true);
  });

  it('names the server from the workspace map, then the signed in list, and a thread by its parent (ws-conv-names)', () => {
    const r = record();
    r.guilds = { g: 'Sandbox' };
    r.conversations['4'] = { ...newConversation('4', { kind: 'thread', guildId: 'h', name: 'patch notes', parentName: 'general' }), count: 5, bytes: 50 };
    const s = summarizeWorkspace(r, { guilds: { h: 'Friends' } });
    const byCid = Object.fromEntries(s.conversations.map((c) => [c.cid, c]));
    expect(byCid['1']).toMatchObject({ guildName: 'Sandbox', parentName: null });
    expect(byCid['4']).toMatchObject({ guildName: 'Friends', parentName: 'general' });
    expect(summarizeWorkspace(r).conversations.find((c) => c.cid === '4')?.guildName).toBeNull();
  });

  it('names a bulk run by its progress, ahead of a conversation action', () => {
    const r = record();
    r.conversations['1'].action = { kind: 'loadAll', settings: null };
    expect(summarizeWorkspace(r).work).toEqual({ kind: 'loadAll', count: 300 });
    r.bulk = { kind: 'bulkExport', mode: 'channels', guildId: 'g', settings: null, queue: ['1', '2'], done: ['1'], inHand: '2', total: 12, doneCount: 3 };
    expect(summarizeWorkspace(r).work).toEqual({ kind: 'export', done: 3, total: 12 });
  });

  it('leaves an export run conversation out of the list and the count (WP6c)', () => {
    const r = record();
    r.conversations['run:9'] = { ...newConversation('run:9', { kind: 'channel', guildId: 'g', name: 'raids' }), count: 50, bytes: 500 };
    const s = summarizeWorkspace(r);
    expect(s.conversations.map((c) => c.cid)).toEqual(['2', '1']);
    expect(s.count).toBe(800);
  });

  it('marks a row held by another window', () => {
    expect(summarizeWorkspace(record(), { heldElsewhere: true }).heldElsewhere).toBe(true);
  });

  it('picks names and colours not yet taken', () => {
    expect(nextWorkspaceName('Workspace', ['Default', 'Workspace 2'])).toBe('Workspace 3');
    expect(copyName('Raid', 'copy', [])).toBe('Raid copy');
    expect(copyName('Raid', 'copy', ['Raid copy'])).toBe('Raid copy 2');
    expect(nextWorkspaceColor(['#5865f2', WORKSPACE_COLORS[0]])).toBe(WORKSPACE_COLORS[1]);
  });
});
