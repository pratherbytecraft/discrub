/**
 * 2.2.5 WP4b: the Export, Bulk Export, Bulk Purge and Bulk Edit dialogs
 * open in resume mode when the open workspace has an unfinished run of
 * theirs (plan section 6): the saved settings, the run's own channels, one
 * note line, Resume, and Start over on the left.
 */
import { ensureTestDefaultWorkspace } from '@/test/workspaceDefault';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import type { Channel } from 'discrub-core/types/discord-types';
import { ChannelType } from 'discrub-core/discord-enum';
import { createAuthenticatedState, messageStateWith } from '@/test/state-factories';
import { createMockMessage } from '@/test/fixtures';
import BulkPurgeDialog from './BulkPurgeDialog';
import BulkEditDialog from './BulkEditDialog';
import BulkExportDialog from '@containers/ExportView/BulkExportDialog';
import ExportDialog from '@containers/ExportView/ExportDialog';
import { bulkPurgeChannels } from '@features/purge/purgeSlice';
import { bulkEditChannels } from '@features/message/messageSlice';
import { buildConfigSnapshot, bulkExportChannels, exportMessages } from '@features/export/exportSlice';
import { initialExportState } from '@features/export/exportTypes';
import { initialWorkspaceState, type UnfinishedBulk } from '@features/workspace/workspaceSlice';
import { LEGACY_DEFAULT_WORKSPACE_ID, type WorkspaceBulk } from '@features/workspace/workspaceTypes';
import type { PurgeConfig } from '@features/purge/purgeTypes';
import {
  deleteWorkspaceDatabase,
  getWorkspace,
  updateConversation,
  updateWorkspace,
} from '@services/workspaceStore';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn(() => ({})) }));
// Row 134: Sign in again reads the open Discord tab, which only the extension can do.
vi.mock('@/extension/messaging', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/extension/messaging')>()), isExtensionMode: () => true }));
vi.mock('@features/purge/purgeSlice', async () => {
  const actual = await vi.importActual('@features/purge/purgeSlice');
  return { ...actual, bulkPurgeChannels: vi.fn(() => ({ type: 'purge/bulkPurgeChannels/mock' })) };
});
vi.mock('@features/message/messageSlice', async () => {
  const actual = await vi.importActual('@features/message/messageSlice');
  return { ...actual, bulkEditChannels: vi.fn(() => ({ type: 'message/bulkEditChannels/mock' })) };
});
vi.mock('@features/export/exportSlice', async () => {
  const actual = await vi.importActual('@features/export/exportSlice');
  return {
    ...actual,
    bulkExportChannels: vi.fn(() => ({ type: 'export/bulkExportChannels/mock' })),
    exportMessages: vi.fn(() => ({ type: 'export/exportMessages/mock' })),
  };
});

const CHANNELS: Channel[] = [
  { id: 'c1', name: 'one', type: ChannelType.GUILD_TEXT, guild_id: '42' } as Channel,
  { id: 'c2', name: 'two', type: ChannelType.GUILD_TEXT, guild_id: '42' } as Channel,
  { id: 'c3', name: 'three', type: ChannelType.GUILD_TEXT, guild_id: '42' } as Channel,
];
const CONFIG: PurgeConfig = {
  mode: 'messages',
  targetUserIds: ['999'],
  retainAttachedMedia: true,
  deleteAttachmentsOnly: false,
  preserveMediaAndLinks: false,
  systemMessageTypesToDelete: [],
  skipArchivedThreads: true,
};

const base = createAuthenticatedState();
const GUILD_ID = base.guild.selectedGuild!.id;

function stateWith(bulk: UnfinishedBulk | null, extra: Record<string, unknown> = {}) {
  return {
    ...base,
    channel: { ...base.channel, channels: CHANNELS },
    user: { currentUser: { id: '999', username: 'me', discriminator: '0', global_name: 'Me', avatar: null }, isLoading: false, error: null },
    workspace: { ...initialWorkspaceState, currentWid: LEGACY_DEFAULT_WORKSPACE_ID, ready: true, bulk },
    ...extra,
  };
}

async function saveBulk(record: Partial<WorkspaceBulk>) {
  await updateWorkspace(LEGACY_DEFAULT_WORKSPACE_ID, (w) => {
    w.bulk = {
      kind: 'bulkPurge',
      mode: 'channels',
      guildId: GUILD_ID,
      settings: null,
      queue: ['c1', 'c2', 'c3'],
      done: ['c1'],
      inHand: 'c2',
      total: 3,
      doneCount: 1,
      ...record,
    } as WorkspaceBulk;
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await deleteWorkspaceDatabase();
  await ensureTestDefaultWorkspace();
});

afterEach(async () => {
  await deleteWorkspaceDatabase();
});

describe('Bulk Purge resume', () => {
  const mirror: UnfinishedBulk = { kind: 'bulkPurge', mode: 'channels', guildId: GUILD_ID, total: 3, doneCount: 1, remaining: 2 };

  it('brings back the settings and the channels not yet finished, whatever is selected', async () => {
    await saveBulk({ settings: { config: CONFIG, searchCriteria: null } });
    renderWithProviders(<BulkPurgeDialog open onClose={vi.fn()} channels={[]} mode="channels" guildId={GUILD_ID} />, { preloadedState: stateWith(mirror) });
    expect(await screen.findByTestId('purge-resume-note')).toHaveTextContent('This purge was running when Discrub closed. Resume picks it up.');
    await waitFor(() => expect(screen.getByTestId('purge-confirm')).toHaveTextContent('Resume'));
    fireEvent.click(screen.getByTestId('purge-confirm'));
    expect(bulkPurgeChannels).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(bulkPurgeChannels).mock.calls[0][0];
    expect(arg.channels.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(arg.config).toMatchObject({ mode: 'messages', retainAttachedMedia: true, skipArchivedThreads: true });
  });

  it('Start over drops the run and returns to the selection', async () => {
    await saveBulk({ settings: { config: CONFIG, searchCriteria: null } });
    renderWithProviders(<BulkPurgeDialog open onClose={vi.fn()} channels={[CHANNELS[0]]} mode="channels" guildId={GUILD_ID} />, { preloadedState: stateWith(mirror) });
    fireEvent.click(await screen.findByTestId('purge-start-over'));
    await waitFor(() => expect(screen.queryByTestId('purge-resume-note')).not.toBeInTheDocument());
    expect(screen.getByTestId('purge-confirm')).not.toHaveTextContent('Resume');
    await waitFor(async () => expect((await getWorkspace(LEGACY_DEFAULT_WORKSPACE_ID))?.bulk).toBeNull());
  });

  it('stays a plain dialog for a run in another server or list', async () => {
    await saveBulk({ guildId: 'elsewhere', settings: { config: CONFIG, searchCriteria: null } });
    renderWithProviders(<BulkPurgeDialog open onClose={vi.fn()} channels={[CHANNELS[0]]} mode="channels" guildId={GUILD_ID} />, {
      preloadedState: stateWith({ ...mirror, guildId: 'elsewhere' }),
    });
    expect(screen.queryByTestId('purge-resume-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('purge-confirm')).not.toHaveTextContent('Resume');
  });
});

describe('Bulk Edit resume', () => {
  it('brings back the text and the remaining channels', async () => {
    await saveBulk({ kind: 'bulkEdit', settings: { content: 'redacted', searchCriteria: null } });
    renderWithProviders(<BulkEditDialog open onClose={vi.fn()} channels={[]} mode="channels" guildId={GUILD_ID} />, {
      preloadedState: stateWith({ kind: 'bulkEdit', mode: 'channels', guildId: GUILD_ID, total: 3, doneCount: 1, remaining: 2 }),
    });
    expect(await screen.findByTestId('bulk-edit-resume-note')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue('redacted')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bulk-edit-confirm'));
    const arg = vi.mocked(bulkEditChannels).mock.calls[0][0];
    expect(arg.content).toBe('redacted');
    expect(arg.channels.map((c) => c.id)).toEqual(['c2', 'c3']);
  });
});

describe('Bulk Export resume', () => {
  it('says how many finished, skips them and runs the rest into a new zip', async () => {
    await saveBulk({ kind: 'bulkExport', done: [], inHand: null, total: 5, doneCount: 2, settings: { snapshot: null, searchCriteria: null } });
    renderWithProviders(<BulkExportDialog open onClose={vi.fn()} channels={[]} mode="channels" guildId={GUILD_ID} />, {
      preloadedState: stateWith({ kind: 'bulkExport', mode: 'channels', guildId: GUILD_ID, total: 5, doneCount: 2, remaining: 3 }),
    });
    expect(await screen.findByTestId('bulk-export-resume-note')).toHaveTextContent('2 of 5 channels finished before Discrub closed. Resume skips them and writes a new zip.');
    await waitFor(() => expect(screen.getByTestId('bulk-export-confirm')).toHaveTextContent('Resume'));
    fireEvent.click(screen.getByTestId('bulk-export-confirm'));
    const arg = vi.mocked(bulkExportChannels).mock.calls[0][0];
    expect(arg.channels.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    // The run picks up its record, so the units that finished render from the workspace (WP6c).
    expect(arg.resume).toBe(true);
  });
});

describe('a run the sign in expired on (row 134)', () => {
  it('offers Sign in again beside Resume', async () => {
    await saveBulk({ kind: 'bulkExport', done: [], inHand: null, total: 5, doneCount: 2, signInExpired: true, settings: { snapshot: null, searchCriteria: null } });
    renderWithProviders(<BulkExportDialog open onClose={vi.fn()} channels={[]} mode="channels" guildId={GUILD_ID} />, {
      preloadedState: stateWith({ kind: 'bulkExport', mode: 'channels', guildId: GUILD_ID, total: 5, doneCount: 2, remaining: 3, signInExpired: true }),
    });
    expect(await screen.findByTestId('bulk-export-sign-in-again')).toHaveTextContent('The sign in expired. Sign in to Discord in this tab, then click Sign in again and Resume.');
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('bulk-export-confirm')).toHaveTextContent('Resume'));
  });

  it('a run that was only cut shows no Sign in again', async () => {
    await saveBulk({ settings: { config: CONFIG, searchCriteria: null } });
    renderWithProviders(<BulkPurgeDialog open onClose={vi.fn()} channels={[]} mode="channels" guildId={GUILD_ID} />, {
      preloadedState: stateWith({ kind: 'bulkPurge', mode: 'channels', guildId: GUILD_ID, total: 3, doneCount: 1, remaining: 2 }),
    });
    await screen.findByTestId('purge-resume-note');
    expect(screen.queryByTestId('purge-sign-in-again')).not.toBeInTheDocument();
  });
});

describe('Export resume', () => {
  it('applies the saved settings and reads Resume', async () => {
    await updateConversation(LEGACY_DEFAULT_WORKSPACE_ID, '801', (c) => {
      c.action = {
        kind: 'export',
        settings: {
          snapshot: { ...buildConfigSnapshot({ export: initialExportState } as never), format: 'json', messagesPerPage: 500 },
        },
      };
    }, { kind: 'channel', guildId: GUILD_ID, name: 'general' });
    const channel = { id: '801', name: 'general', type: ChannelType.GUILD_TEXT, guild_id: GUILD_ID } as Channel;
    const { store } = renderWithProviders(<ExportDialog open onClose={vi.fn()} />, {
      preloadedState: {
        ...stateWith(null),
        channel: { ...base.channel, channels: [channel], selectedChannel: channel },
        message: { ...base.message, ...messageStateWith(base.message, [createMockMessage({ id: '1', channel_id: '801' })]) },
        workspace: { ...initialWorkspaceState, currentWid: LEGACY_DEFAULT_WORKSPACE_ID, ready: true, actions: { '801': { cid: '801', name: 'general', kind: 'export' } } },
      },
    });
    expect(await screen.findByTestId('export-resume-note')).toHaveTextContent('This export was running when Discrub closed. Resume writes a new zip.');
    await waitFor(() => expect(store.getState().export.exportFormat).toBe('json'));
    expect(store.getState().export.messagesPerPage).toBe(500);
    expect(screen.getByTestId('export-confirm')).toHaveTextContent('Resume');
    expect(exportMessages).not.toHaveBeenCalled();
  });
});
