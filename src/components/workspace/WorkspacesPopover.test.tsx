import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, within, waitFor } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import { initialSupporterState } from '@features/supporter/supporterTypes';
import { initialWorkspaceState } from '@features/workspace/workspaceSlice';
import type { WorkspaceSummary } from '@features/workspace/workspaceSummary';
import { exportWorkspaceFile, importWorkspaceFile, readWorkspaceManifest, WorkspaceFileError, type WorkspaceManifest } from '@services/workspaceArchive';
import WorkspacesPopover from './WorkspacesPopover';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn(() => ({})) }));
vi.mock('@services/workspaceArchive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/workspaceArchive')>();
  return {
    ...actual,
    exportWorkspaceFile: vi.fn(async () => null),
    importWorkspaceFile: vi.fn(async () => ({ record: {}, messages: 0 })),
    readWorkspaceManifest: vi.fn(),
  };
});
vi.mock('@services/workspaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/workspaceStore')>();
  // The refresh on open never settles here, so the list each test preloads stays.
  return { ...actual, listWorkspaces: vi.fn(() => new Promise(() => {})), readStorageEstimate: vi.fn(async () => null) };
});

const supporter = { ...initialSupporterState, keyStatus: 'valid' as const, payload: { v: 2, kid: 'k', jti: 'j', name: 'Jordan', eh: 'x', ent: { themes: null }, iat: 1, exp: null }, lastRefreshAt: 1 };

const ws = (over: Partial<WorkspaceSummary>): WorkspaceSummary => ({
  wid: 'default', name: 'Default', color: '#5865f2', bytes: 190_000_000, count: 14_620, conversationCount: 3,
  lastOpened: Date.now() - 2 * 3600_000, openable: true, appVersion: '2.2.5', heldElsewhere: false, isDefault: false, work: null,
  conversations: [{ cid: '801', kind: 'channel', name: 'general', guildName: 'Sandbox', parentName: null, count: 14_000, bytes: 180_000_000 }],
  ...over,
});

const LIST = [
  ws({ isDefault: true }),
  ws({ wid: 'w2', name: 'Raid archive', color: '#3ba55c', bytes: 1_400_000_000, count: 1_180_400, conversationCount: 12, work: { kind: 'export', done: 3, total: 12 } }),
  ws({ wid: 'w3', name: 'Mod cleanup', color: '#faa61a', heldElsewhere: true }),
];

function render(isSupporter: boolean, extra: { list?: WorkspaceSummary[]; importing?: { name: string; messages: number; total: number } } = {}) {
  const state = createBaseState();
  if (isSupporter) state.supporter = supporter as typeof state.supporter;
  (state as Record<string, unknown>).workspace = { ...initialWorkspaceState, currentWid: 'default', currentName: 'Default', ready: true, list: extra.list ?? LIST, importing: extra.importing ?? null, storage: { usage: 1_600_000_000, quota: 10_737_418_240, remaining: 9_137_418_240 } };
  return renderWithProviders(<WorkspacesPopover anchorEl={document.body} open onClose={vi.fn()} />, { preloadedState: state });
}

describe('WorkspacesPopover (2.2.5 WP5)', () => {
  it('names the server beside each conversation (ws-conv-names)', () => {
    render(true);
    fireEvent.click(screen.getByTestId('workspace-row-toggle-default'));
    expect(screen.getByTestId('workspace-conversation-801')).toHaveTextContent('# general · Sandbox');
  });

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

  it('free accounts see the supporter lock on New and Duplicate (not Import, row 3) and the Supporter only row', () => {
    render(false);
    expect(screen.getByTestId('workspace-supporter-only')).toHaveTextContent('Supporter only');
    fireEvent.click(screen.getByTestId('workspace-row-toggle-default'));
    expect(screen.getAllByTestId('workspace-lock')).toHaveLength(3);
    expect(screen.queryByTestId('workspace-delete')).toBeNull();
  });

  it('a supporter at 8 workspaces cannot make another: New and Duplicate wait, one plain line (rows 33, 34)', () => {
    const eight = [ws({ isDefault: true }), ...Array.from({ length: 7 }, (_, i) => ws({ wid: `w${i + 2}`, name: `Workspace ${i + 2}` }))];
    render(true, { list: eight });
    expect(screen.getByTestId('workspace-new')).toBeDisabled();
    expect(screen.getByTestId('workspace-at-cap')).toHaveTextContent('8 of 8 workspaces.');
    fireEvent.click(screen.getByTestId('workspace-row-toggle-w2'));
    expect(screen.getByTestId('workspace-duplicate')).toBeDisabled();
  });

  it('an import under way shows its progress and holds New and Import (row 9)', () => {
    render(true, { importing: { name: 'Raid archive', messages: 12_000, total: 50_000 } });
    expect(screen.getByTestId('workspace-import-progress')).toHaveTextContent('Importing Raid archive: 12,000 of 50,000 messages');
    expect(screen.getByTestId('workspace-new')).toBeDisabled();
    expect(screen.getByTestId('workspace-import')).toBeDisabled();
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

  describe('export and import (WP6b)', () => {
    const manifest = (over: Partial<WorkspaceManifest>): WorkspaceManifest => ({
      format: 'discrub-workspace', schema: 1, appVersion: '2.2.5', wid: 'w2', name: 'Raid archive', color: '#3ba55c',
      createdAt: 1, exportedAt: Date.UTC(2026, 9, 11, 12), conversations: 12, messages: 1_204_100, bytes: 1,
      ...over,
    });
    const pick = () => {
      const file = new File(['x'], 'Raid archive.discrub-workspace');
      fireEvent.change(screen.getByTestId('workspace-import-input'), { target: { files: [file] } });
      return file;
    };

    it('Export asks first, says the file holds message content, then writes the file', async () => {
      render(true);
      fireEvent.click(screen.getByTestId('workspace-row-toggle-w2'));
      fireEvent.click(screen.getByTestId('workspace-export'));
      const confirm = screen.getByTestId('workspace-confirm');
      expect(within(confirm).getByText('Export Raid archive')).toBeInTheDocument();
      expect(within(confirm).getByText(/The file holds message content\./)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('workspace-confirm-button'));
      await waitFor(() => expect(exportWorkspaceFile).toHaveBeenCalledWith('w2'));
    });

    it('a file whose workspace is already here shows both side by side, and Replace writes over it', async () => {
      vi.mocked(readWorkspaceManifest).mockResolvedValue(manifest({}));
      vi.mocked(importWorkspaceFile).mockClear();
      render(true);
      pick();
      const dialog = await screen.findByTestId('workspace-import-dialog');
      expect(within(dialog).getByText('Workspace already here')).toBeInTheDocument();
      expect(within(screen.getByTestId('workspace-import-here')).getByText('Export 3 of 12')).toBeInTheDocument();
      expect(within(screen.getByTestId('workspace-import-file')).getByText('1,204,100 messages')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('workspace-import-replace'));
      await waitFor(() => expect(importWorkspaceFile).toHaveBeenCalled());
      // Row 117: the file is read into a staged workspace and swapped over w2 at the end.
      const target = vi.mocked(importWorkspaceFile).mock.calls[0][1];
      expect(target.name).toBe('Raid archive');
      expect(target.wid).not.toBe('w2');
    });

    it('Keep both imports beside it under a new id and a numbered name', async () => {
      vi.mocked(readWorkspaceManifest).mockResolvedValue(manifest({}));
      vi.mocked(importWorkspaceFile).mockClear();
      render(true);
      pick();
      fireEvent.click(await screen.findByTestId('workspace-import-keep-both'));
      await waitFor(() => expect(importWorkspaceFile).toHaveBeenCalled());
      const target = vi.mocked(importWorkspaceFile).mock.calls[0][1];
      expect(target.name).toBe('Raid archive (2)');
      expect(target.wid).not.toBe('w2');
    });

    it('a supporter importing a new workspace gets it in its own slot without a dialog', async () => {
      vi.mocked(readWorkspaceManifest).mockResolvedValue(manifest({ wid: 'elsewhere', name: 'Old raids' }));
      vi.mocked(importWorkspaceFile).mockClear();
      render(true);
      pick();
      await waitFor(() => expect(importWorkspaceFile).toHaveBeenCalled());
      expect(screen.queryByTestId('workspace-import-dialog')).toBeNull();
      expect(vi.mocked(importWorkspaceFile).mock.calls[0][1]).toMatchObject({ wid: 'elsewhere', name: 'Old raids' });
    });

    it('a free account is asked before Default is replaced, and Keep both opens the supporter hub', async () => {
      vi.mocked(readWorkspaceManifest).mockResolvedValue(manifest({ wid: 'elsewhere', name: 'Old raids' }));
      vi.mocked(importWorkspaceFile).mockClear();
      const { store } = render(false);
      pick();
      const dialog = await screen.findByTestId('workspace-import-dialog');
      expect(within(dialog).getByText('Replace Default')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('workspace-import-keep-both'));
      expect(store.getState().supporter.panelOpen).toBe(true);
      expect(importWorkspaceFile).not.toHaveBeenCalled();
    });

    it('a file from a newer Discrub names the version it needs', async () => {
      vi.mocked(readWorkspaceManifest).mockRejectedValue(new WorkspaceFileError('needsUpdate', 'newer', '3.0.0'));
      const { store } = render(true);
      pick();
      await waitFor(() => expect(store.getState().status.toast.message).toBe('This workspace file needs Discrub 3.0.0'));
    });
  });
});
