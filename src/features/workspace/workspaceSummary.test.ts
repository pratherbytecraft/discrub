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

  it('names a bulk run by its progress, ahead of a conversation action', () => {
    const r = record();
    r.conversations['1'].action = { kind: 'loadAll', settings: null };
    expect(summarizeWorkspace(r).work).toEqual({ kind: 'loadAll', count: 300 });
    r.bulk = { kind: 'bulkExport', mode: 'channels', guildId: 'g', settings: null, queue: ['1', '2'], done: ['1'], inHand: '2', total: 12, doneCount: 3 };
    expect(summarizeWorkspace(r).work).toEqual({ kind: 'export', done: 3, total: 12 });
  });

  it('marks a row held by another window', () => {
    expect(summarizeWorkspace(record(), true).heldElsewhere).toBe(true);
  });

  it('picks names and colours not yet taken', () => {
    expect(nextWorkspaceName('Workspace', ['Default', 'Workspace 2'])).toBe('Workspace 3');
    expect(copyName('Raid', 'copy', [])).toBe('Raid copy');
    expect(copyName('Raid', 'copy', ['Raid copy'])).toBe('Raid copy 2');
    expect(nextWorkspaceColor(['#5865f2', WORKSPACE_COLORS[0]])).toBe(WORKSPACE_COLORS[1]);
  });
});
