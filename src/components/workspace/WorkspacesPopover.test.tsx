import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, within } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import { initialWorkspaceState } from '@features/workspace/workspaceSlice';
import type { WorkspaceSummary } from '@features/workspace/workspaceSummary';
import WorkspacesPopover from './WorkspacesPopover';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn(() => ({})) }));

const supporter = { ...initialSupporterState, keyStatus: 'valid' as const, payload: { v: 2, kid: 'k', jti: 'j', name: 'Jordan', eh: 'x', ent: { themes: null }, iat: 1, exp: null }, lastRefreshAt: 1 };

const ws = (over: Partial<WorkspaceSummary>): WorkspaceSummary => ({
  wid: 'default', name: 'Default', color: '#5865f2', bytes: 190_000_000, count: 14_620, conversationCount: 3,
  lastOpened: Date.now() - 2 * 3600_000, openable: true, appVersion: '2.2.5', heldElsewhere: false, work: null,
  conversations: [{ cid: '801', kind: 'channel', name: 'general', count: 14_000, bytes: 180_000_000 }],
  ...over,
});

const LIST = [
  ws({}),
  ws({ wid: 'w2', name: 'Raid archive', color: '#3ba55c', bytes: 1_400_000_000, count: 1_180_400, conversationCount: 12, work: { kind: 'export', done: 3, total: 12 } }),
  ws({ wid: 'w3', name: 'Mod cleanup', color: '#faa61a', heldElsewhere: true }),
];

function render(isSupporter: boolean) {
  const state = createBaseState();
  if (isSupporter) state.supporter = supporter as typeof state.supporter;
  (state as Record<string, unknown>).workspace = { ...initialWorkspaceState, currentWid: 'default', currentName: 'Default', ready: true, list: LIST, storage: { usage: 1_600_000_000, quota: 10_737_418_240, remaining: 9_137_418_240 } };
  return renderWithProviders(<WorkspacesPopover anchorEl={document.body} open onClose={vi.fn()} />, { preloadedState: state });
}

describe('WorkspacesPopover (2.2.5 WP5)', () => {
  it('lists each workspace with its state and the disk line', () => {
    render(true);
    const current = screen.getByTestId('workspace-row-default');
    expect(within(current).getByText('Open now')).toBeInTheDocument();
    expect(within(current).getByText(/3 conversations · 14,620 messages · 190 MB/)).toBeInTheDocument();
    expect(within(screen.getByTestId('workspace-row-w2')).getByText('Export 3 of 12')).toBeInTheDocument();
    expect(within(screen.getByTestId('workspace-row-w3')).getByText('Another window')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-on-disk')).toHaveTextContent('1.8 GB on disk');
    expect(screen.getByTestId('workspace-remaining')).toHaveTextContent('9.1 GB remaining');
  });

  it('free accounts see the supporter lock on New and Duplicate and the Supporter only row', () => {
    render(false);
    expect(screen.getByTestId('workspace-supporter-only')).toHaveTextContent('Supporter only');
    fireEvent.click(screen.getByTestId('workspace-row-toggle-default'));
    expect(screen.getAllByTestId('workspace-lock')).toHaveLength(3);
    expect(screen.queryByTestId('workspace-delete')).toBeNull();
  });

  it('supporters see no lock and Delete on workspaces other than Default', () => {
    render(true);
    expect(screen.queryByTestId('workspace-supporter-only')).toBeNull();
    fireEvent.click(screen.getByTestId('workspace-row-toggle-w2'));
    expect(screen.queryAllByTestId('workspace-lock')).toHaveLength(0);
    expect(screen.getByTestId('workspace-delete')).toBeInTheDocument();
  });

  it('a free New opens the supporter hub instead of making a workspace', () => {
    const { store } = render(false);
    fireEvent.click(screen.getByTestId('workspace-new'));
    expect(store.getState().supporter.panelOpen).toBe(true);
  });

  it('rename edits inline and Escape leaves the name alone', () => {
    render(true);
    fireEvent.click(screen.getByTestId('workspace-row-toggle-w2'));
    fireEvent.click(screen.getByTestId('workspace-rename'));
    const input = screen.getByTestId('workspace-rename-input') as HTMLInputElement;
    expect(input.value).toBe('Raid archive');
    fireEvent.change(input, { target: { value: 'Raids' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('workspace-rename-input')).toBeNull();
    expect(within(screen.getByTestId('workspace-row-w2')).getByText('Raid archive')).toBeInTheDocument();
  });

  it('clearing a conversation asks first and names its size', () => {
    render(true);
    fireEvent.click(screen.getByTestId('workspace-row-toggle-default'));
    fireEvent.click(screen.getByTestId('workspace-conversation-clear-801'));
    const dialog = screen.getByTestId('workspace-confirm');
    expect(within(dialog).getByText('Clear #general')).toBeInTheDocument();
    expect(within(dialog).getByText('Removes 14,000 messages (180 MB) from this workspace. Its filters and settings stay.')).toBeInTheDocument();
  });
});
