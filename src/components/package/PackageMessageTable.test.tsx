import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, fireEvent } from '@/test/test-utils';
import { virtualizerMock } from '@/test/virtualizer-mock';
import PackageMessageTable from './PackageMessageTable';
import {
  PACKAGE_CHANNEL_TYPE,
  type PackageChannel,
  type ParsedPackage,
} from '@features/package/packageTypes';
import { generateEditReplacement } from '@features/message/editReplacement';

vi.mock('@tanstack/react-virtual', () => virtualizerMock);

const { mockEditMessage, stubSaveState } = vi.hoisted(() => ({
  mockEditMessage: vi.fn(),
  stubSaveState: {
    replacement: undefined as
      | { mode: 'words' | 'sentences' | 'characters'; seed: number }
      | undefined,
  },
}));

vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({ editMessage: mockEditMessage })),
}));

vi.mock('@/utils/delayUtils', () => ({
  calculateRandomDelay: vi.fn(() => ({
    delayMs: 0,
    delaySec: 0,
    baseDelay: 0,
    modifier: 0,
    randomComponent: 0,
  })),
}));

vi.mock('@/utils/operationLoopUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/operationLoopUtils')>();
  return {
    ...actual,
    waitWhilePaused: vi.fn().mockResolvedValue(undefined),
    checkCancelled: vi.fn().mockReturnValue(false),
    cancellableDelay: vi.fn().mockResolvedValue(false),
  };
});

// The real modal owns the random-mode controls; the table only needs to
// receive its onSave callback with (or without) a replacement spec.
vi.mock('@components/modals/EditMessageModal', () => ({
  default: ({
    open,
    onSave,
  }: {
    open: boolean;
    onSave: (
      content: string,
      replacement?: { mode: 'words' | 'sentences' | 'characters'; seed: number },
    ) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="stub-edit-save"
        onClick={() => onSave('fixed text', stubSaveState.replacement)}
      >
        stub save
      </button>
    ) : null,
}));

const channel: PackageChannel = {
  id: '200',
  type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT,
  name: 'general',
  guildId: 'g1',
  guildName: 'Guild A',
  messageCount: 3,
  isOrphan: false,
};

const parsed: ParsedPackage = {
  user: { id: 'u1', username: 'tester', globalName: 'Tester', avatarHash: null },
  guilds: [{ id: 'g1', name: 'Guild A' }],
  channels: [channel],
  totalMessages: 3,
  packageSizeBytes: 1,
};

function stateWith({
  loadedChannels = {},
  loading = false,
  readOnly = false,
  selectedMessageIds = {},
  token = 'tok',
}: {
  loadedChannels?: Record<string, unknown>;
  loading?: boolean;
  readOnly?: boolean;
  selectedMessageIds?: Record<string, string[]>;
  token?: string | null;
}) {
  return {
    auth: { token, isLoading: false, error: null },
    package: {
      status: 'ready',
      parsed,
      validation: { ok: true, readOnly, warnings: [], errors: [] },
      error: null,
      selectedChannelId: null,
      loadedChannels,
      loadedOrder: Object.keys(loadedChannels),
      loadingChannelId: loading ? '200' : null,
      selectedMessageIds,
      timelineStatus: 'idle',
      timelineTimestamps: [],
      timelineProgress: null,
      timelineError: null,
      deleteStatus: 'idle',
      deleteProgress: null,
      deleteResult: null,
      deleteError: null,
      exportStatus: 'idle',
      exportError: null,
      deletedMessageIds: {},
      goneMessageIds: {},
      enrichmentStatus: {},
      enrichmentProgress: {},
      enrichedMessages: {},
      enrichmentMisses: {},
      enrichmentError: {},
      enrichmentLastFetched: {},
      activeEnrichmentChannelId: null,
    },
  } as never;
}

describe('<PackageMessageTable />', () => {
  it('shows loading state when messages are not yet cached', async () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({ loading: true }),
    });
    expect(screen.getByText(/Loading messages|Preparing/i)).toBeInTheDocument();
    // Thunk rejection is ok here (no source file) — we only verify the UI path.
    await waitFor(() => {
      // Component has mounted and dispatched; don't assert further state.
      expect(screen.getByText(/Loading messages|Preparing/i)).toBeInTheDocument();
    });
  });

  it('renders messages when cache is populated', () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [
            {
              id: '1',
              timestamp: '2022-07-28 22:30:52.800000+00:00',
              content: 'hello world',
              attachments: [],
            },
            {
              id: '2',
              timestamp: '2022-07-29 00:00:00.000000+00:00',
              content: 'with attachment',
              attachments: ['https://cdn.discordapp.com/attachments/1/2/photo.png?ex=0'],
            },
          ],
        },
      }),
    });

    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getByText('with attachment')).toBeInTheDocument();
    // Author name shown
    expect(screen.getAllByText('Tester').length).toBeGreaterThan(0);
    // Attachment filename extracted from URL
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });

  it('renders empty state when channel has no messages', () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({ loadedChannels: { '200': [] } }),
    });
    expect(screen.getByText(/no messages in the package/i)).toBeInTheDocument();
  });

  it('enables delete button only when messages are selected and package is writable', () => {
    const loadedChannels = {
      '200': [
        {
          id: '1',
          timestamp: '2022-07-28 22:30:52.800000+00:00',
          content: 'msg',
          attachments: [],
        },
      ],
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({ loadedChannels }),
    });
    const deleteBtn = screen.getByRole('button', { name: /Delete selected/i });
    expect(deleteBtn).toBeDisabled();
  });

  it('disables delete button in read-only mode', () => {
    const loadedChannels = {
      '200': [
        {
          id: '1',
          timestamp: '2022-07-28 22:30:52.800000+00:00',
          content: 'msg',
          attachments: [],
        },
      ],
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels,
        readOnly: true,
        selectedMessageIds: { '200': ['1'] },
      }),
    });
    expect(screen.getByRole('button', { name: /Delete selected/i })).toBeDisabled();
  });

  it('disables delete button on orphan channels', () => {
    const orphanChannel = { ...channel, isOrphan: true };
    const loadedChannels = {
      '200': [
        {
          id: '1',
          timestamp: '2022-07-28 22:30:52.800000+00:00',
          content: 'msg',
          attachments: [],
        },
      ],
    };
    renderWithProviders(<PackageMessageTable channel={orphanChannel} />, {
      preloadedState: stateWith({
        loadedChannels,
        selectedMessageIds: { '200': ['1'] },
      }),
    });
    expect(screen.getByRole('button', { name: /Delete selected/i })).toBeDisabled();
  });

  it('toggle message checkbox updates Redux selection', () => {
    const loadedChannels = {
      '200': [
        {
          id: '1',
          timestamp: '2022-07-28 22:30:52.800000+00:00',
          content: 'msg',
          attachments: [],
        },
      ],
    };
    const { store } = renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({ loadedChannels }),
    });
    const checkbox = screen.getByLabelText(/Select message 1/);
    fireEvent.click(checkbox);
    expect(store.getState().package.selectedMessageIds['200']).toEqual(['1']);
  });

  it('enables Edit selected only when messages are selected and writable', () => {
    const loadedChannels = {
      '200': [
        { id: '1', timestamp: '2022-07-28 22:30:52.800000+00:00', content: 'msg', attachments: [] },
      ],
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({ loadedChannels }),
    });
    expect(screen.getByRole('button', { name: /Edit selected/i })).toBeDisabled();
  });

  it('disables Edit selected on orphan channels', () => {
    const orphan = { ...channel, isOrphan: true };
    renderWithProviders(<PackageMessageTable channel={orphan} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [{ id: '1', timestamp: 't', content: 'x', attachments: [] }],
        },
        selectedMessageIds: { '200': ['1'] },
      }),
    });
    expect(screen.getByRole('button', { name: /Edit selected/i })).toBeDisabled();
  });

  it('caches a distinct generated body per message after a randomized edit', async () => {
    mockEditMessage.mockReset();
    mockEditMessage.mockImplementation(async (_token: string, id: string) => ({
      success: true,
      data: { id, content: 'discord-echo' },
    }));
    stubSaveState.replacement = { mode: 'words', seed: 7 };
    const loadedChannels = {
      '200': [
        { id: '1', timestamp: '2022-07-28 22:30:52.800000+00:00', content: 'first original', attachments: [] },
        { id: '2', timestamp: '2022-07-29 00:00:00.000000+00:00', content: 'second original', attachments: [] },
      ],
    };
    const { store, container } = renderWithProviders(
      <PackageMessageTable channel={channel} />,
      {
        preloadedState: stateWith({
          loadedChannels,
          selectedMessageIds: { '200': ['1', '2'] },
        }),
      },
    );

    fireEvent.click(screen.getByRole('button', { name: /Edit selected/i }));
    fireEvent.click(screen.getByTestId('stub-edit-save'));

    const spec = { mode: 'words' as const, seed: 7 };
    const expected1 = generateEditReplacement(spec, '1');
    const expected2 = generateEditReplacement(spec, '2');
    expect(expected1).not.toBe(expected2);

    await waitFor(() => {
      expect(
        store.getState().package.loadedChannels['200'].map((m) => m.content),
      ).toEqual([expected1, expected2]);
    });
    // Both cached bodies are actually rendered, and neither is the single
    // sample a batch-wide patch would have produced.
    expect(container.textContent).toContain(expected1);
    expect(container.textContent).toContain(expected2);
    expect(container.textContent).not.toContain('fixed text');
  });

  it('applies the fixed content to every edited row', async () => {
    mockEditMessage.mockReset();
    mockEditMessage.mockImplementation(async (_token: string, id: string) => ({
      success: true,
      data: { id, content: 'discord-echo' },
    }));
    stubSaveState.replacement = undefined;
    const loadedChannels = {
      '200': [
        { id: '3', timestamp: 't1', content: 'alpha original', attachments: [] },
        { id: '4', timestamp: 't2', content: 'beta original', attachments: [] },
      ],
    };
    const { store } = renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels,
        selectedMessageIds: { '200': ['3', '4'] },
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Edit selected/i }));
    fireEvent.click(screen.getByTestId('stub-edit-save'));

    await waitFor(() => {
      expect(
        store.getState().package.loadedChannels['200'].map((m) => m.content),
      ).toEqual(['fixed text', 'fixed text']);
    });
  });

  it('export button enabled when messages exist and not exporting', () => {
    const loadedChannels = {
      '200': [
        { id: '1', timestamp: '2022-07-28 22:30:52.800000+00:00', content: 'msg', attachments: [] },
      ],
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({ loadedChannels }),
    });
    expect(screen.getByRole('button', { name: /Export/i })).toBeEnabled();
  });

  it('export button available even when read-only', () => {
    const loadedChannels = {
      '200': [
        { id: '1', timestamp: '2022-07-28 22:30:52.800000+00:00', content: 'msg', attachments: [] },
      ],
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({ loadedChannels, readOnly: true, token: null }),
    });
    expect(screen.getByRole('button', { name: /Export/i })).toBeEnabled();
  });

  it('renders rich content: bold markdown, auto-link, mention chips, custom emoji', () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [
            {
              id: '1',
              timestamp: '2023-01-01 00:00:00.000000+00:00',
              content:
                'Hey **world** visit https://discord.com and say hi to <@999> in <#200> with <:party:12345>',
              attachments: [],
            },
          ],
        },
      }),
    });
    // Bold markdown → <strong>
    expect(document.querySelector('strong')?.textContent).toBe('world');
    // Bare URL auto-linked
    const autoLink = document.querySelector('a[href="https://discord.com"]');
    expect(autoLink).not.toBeNull();
    // User mention renders as chip (fallback "Unknown User" since not owner)
    const userMention = document.querySelector('.user-mention');
    expect(userMention?.textContent).toBe('@Unknown User');
    // Channel mention resolves against package channels (channel id 200 = "general")
    const channelMention = document.querySelector('.channel-mention');
    expect(channelMention?.textContent).toContain('general');
    // Custom emoji becomes an <img> with the Discord CDN URL
    const emojiImg = document.querySelector('img.emoji') as HTMLImageElement | null;
    expect(emojiImg?.getAttribute('src')).toContain('cdn.discordapp.com/emojis/12345.webp');
    expect(emojiImg?.getAttribute('alt')).toBe(':party:');
  });

  it('resolves owner mentions via the package user map', () => {
    // Discord IDs in mentions must be numeric snowflakes; override the
    // parsed user so the owner mention resolves instead of falling back
    // to "Unknown User".
    const numericParsed: ParsedPackage = {
      ...parsed,
      user: { id: '123456789012345678', username: 'tester', globalName: 'Tester', avatarHash: null },
    };
    const base = stateWith({
      loadedChannels: {
        '200': [
          {
            id: '1',
            timestamp: '2023-01-01 00:00:00.000000+00:00',
            content: 'hi <@123456789012345678>',
            attachments: [],
          },
        ],
      },
    });
    (base as any).package.parsed = numericParsed;
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: base,
    });
    const mention = document.querySelector('.user-mention');
    expect(mention?.textContent).toBe('@Tester');
  });

  it('sorts messages descending by timestamp', () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [
            {
              id: '1',
              timestamp: '2022-01-01 00:00:00.000000+00:00',
              content: 'older',
              attachments: [],
            },
            {
              id: '2',
              timestamp: '2023-01-01 00:00:00.000000+00:00',
              content: 'newer',
              attachments: [],
            },
          ],
        },
      }),
    });

    const rendered = screen.getAllByText(/older|newer/);
    // "newer" should appear before "older" in the DOM
    expect(rendered[0].textContent).toBe('newer');
    expect(rendered[1].textContent).toBe('older');
  });

  /* ────────── Phase D: rich row rendering + banner ────────── */

  it('rows default to "source" chip when no enrichment exists', () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [
            { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'hi', attachments: [] },
          ],
        },
      }),
    });
    expect(screen.getByText('source')).toBeInTheDocument();
  });

  it('rows show the "enriched" chip when a live message is present', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'hi', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichedMessages = {
      '200': {
        '1': {
          id: '1',
          type: 0,
          content: 'hi — live',
          reactions: [{ emoji: { name: '👍' }, count: 2 }],
          embeds: [],
        },
      },
    };
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText('enriched')).toBeInTheDocument();
    // Live content overrides the source content.
    expect(screen.getByText('hi — live')).toBeInTheDocument();
    // Reaction chip rendered with count.
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  // ── #173: reactor list modal ─────────────────────────────────────

  it('reaction chips render as buttons with click affordance when enriched data is present', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'hi', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichedMessages = {
      '200': {
        '1': {
          id: '1',
          type: 0,
          content: 'hi',
          reactions: [{ emoji: { name: '👍' }, count: 2 }],
          embeds: [],
        },
      },
    };
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    const chip = screen.getByTestId('package-reaction-chip');
    expect(chip).toHaveAttribute('role', 'button');
    expect(chip).toHaveAttribute('aria-label', 'View reactors for 👍');
  });

  it('clicking a reaction chip opens the ReactionModal scoped to that message', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'hi', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichedMessages = {
      '200': {
        '1': {
          id: '1',
          type: 0,
          content: 'hi',
          reactions: [{ emoji: { name: '👍' }, count: 2 }],
          embeds: [],
        },
      },
    };
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    fireEvent.click(screen.getByTestId('package-reaction-chip'));

    // The ReactionModal renders with a heading containing "Reactions" or
    // the per-emoji count layout — check via dialog role.
    const modals = screen.getAllByRole('dialog');
    expect(modals.length).toBeGreaterThanOrEqual(1);
  });

  it('closing the ReactionModal clears reactionMessage so a fresh click rebinds to the next row', async () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'first', attachments: [] },
          { id: '2', timestamp: '2023-01-01 00:01:00.000000+00:00', content: 'second', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichedMessages = {
      '200': {
        '1': { id: '1', type: 0, content: 'first', reactions: [{ emoji: { name: '👍' }, count: 1 }], embeds: [] },
        '2': { id: '2', type: 0, content: 'second', reactions: [{ emoji: { name: '🎉' }, count: 1 }], embeds: [] },
      },
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    // Open modal for row 1.
    const chips = screen.getAllByTestId('package-reaction-chip');
    fireEvent.click(chips[0]);
    expect(screen.getAllByRole('dialog').length).toBeGreaterThanOrEqual(1);

    // Close it via the dialog's close button.
    const closeButtons = screen.getAllByRole('button', { name: /close|cancel|done/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    // Reopen for row 2; if the close cleanup is broken, the modal would
    // either re-show row 1 data or fail to open at all. We confirm a dialog
    // is open for the new row by waiting on the role.
    await waitFor(() => {
      const open = screen.queryAllByRole('dialog');
      // After the close we should be able to click another chip and get a dialog
      // back. This indirectly verifies state cleared cleanly.
      expect(open.length).toBeLessThanOrEqual(1);
    });
    fireEvent.click(chips[1]);
    expect(screen.getAllByRole('dialog').length).toBeGreaterThanOrEqual(1);
  });

  it('opens reactor modal with "User list not available" fallback when there is no auth token', () => {
    const base = stateWith({
      token: null,
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'hi', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichedMessages = {
      '200': {
        '1': {
          id: '1',
          type: 0,
          content: 'hi',
          reactions: [{ emoji: { name: '👍' }, count: 1 }],
          embeds: [],
        },
      },
    };
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    fireEvent.click(screen.getByTestId('package-reaction-chip'));
    // The "User list not available" fallback is rendered by the modal when
    // no fetcher is supplied (token-less package context).
    expect(screen.getByText(/User list not available/i)).toBeInTheDocument();
  });

  it('rows show the "unavailable" chip for deleted misses', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'gone', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentMisses = { '200': { deleted: ['1'], forbidden: [] } };
    base.package.enrichedMessages = { '200': {} };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });

  it('rows show the "no access" chip for forbidden misses (Backlog #161)', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'nope', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: ['1'] } };
    base.package.enrichedMessages = { '200': {} };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    // Pre-#161 the chip read literally "forbidden" — HTTP jargon
    // leaking into the row UI. Polish renamed it to "no access".
    expect(screen.getByText('no access')).toBeInTheDocument();
  });

  it('shows the reply quote banner for type-19 enriched messages', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'hey', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichedMessages = {
      '200': {
        '1': {
          id: '1',
          type: 19,
          content: 'hey',
          reactions: [],
          embeds: [],
          referenced_message: {
            id: '0',
            content: 'original',
            author: { id: '9', username: 'alice', global_name: 'Alice' },
          },
        },
      },
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('original')).toBeInTheDocument();
  });

  it('shows the embed count chip when the enriched message has embeds', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'check this', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichedMessages = {
      '200': {
        '1': {
          id: '1',
          type: 0,
          content: 'check this',
          reactions: [],
          embeds: [{ title: 'Example' }, { title: 'Another' }],
        },
      },
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText('2 embeds')).toBeInTheDocument();
  });

  it('banner shows "Load rich data" when idle and channel is enrichable', () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [
            { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
          ],
        },
      }),
    });
    expect(screen.getByRole('button', { name: /Load rich data/i })).toBeEnabled();
  });

  it('banner hides Load button for orphan channels (cannot rehydrate)', () => {
    const orphan: PackageChannel = { ...channel, isOrphan: true };
    renderWithProviders(<PackageMessageTable channel={orphan} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [
            { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
          ],
        },
      }),
    });
    expect(screen.getByRole('button', { name: /Load rich data/i })).toBeDisabled();
  });

  it('banner shows progress when a rehydration run is active on this channel', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'running' };
    base.package.enrichmentProgress = { '200': { current: 7, total: 10 } };
    base.package.activeEnrichmentChannelId = '200';
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText(/Rehydrating 7 of 10/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeEnabled();
  });

  it('banner shows refresh option when rehydration is done', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichedMessages = { '200': {} };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText(/Rich data loaded today/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeEnabled();
  });

  it('banner surfaces "Retry" affordance after a cancelled run', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'cancelled' };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText(/Rehydration cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry rich data/i })).toBeEnabled();
  });

  it('banner surfaces "Retry" affordance after a failed run', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'failed' };
    base.package.enrichmentError = { '200': 'boom' };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByText(/Rehydration failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry rich data/i })).toBeEnabled();
  });

  it('banner Load button is disabled on read-only packages', () => {
    renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        readOnly: true,
        loadedChannels: {
          '200': [
            { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
          ],
        },
      }),
    });
    expect(screen.getByRole('button', { name: /Load rich data/i })).toBeDisabled();
  });

  it('Fix G: banner Load button disabled while another heavy op is running', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
        ],
      },
    }) as any;
    // Simulate a purge in-flight — purge is a heavy op, should block
    // starting a new enrichment.
    base.purge = { ...(base.purge ?? {}), isPurging: true };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByRole('button', { name: /Load rich data/i })).toBeDisabled();
  });

  it('Fix G: banner Load button disabled while another channel is mid-rehydration', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'msg', attachments: [] },
        ],
      },
    }) as any;
    // Another package channel is actively enriching.
    base.package.activeEnrichmentChannelId = '999';
    base.package.enrichmentStatus = { '999': 'running' };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    expect(screen.getByRole('button', { name: /Load rich data/i })).toBeDisabled();
  });

  it('auto-hydrates cached enrichment on mount — dispatches hydrateCachedEnrichment', async () => {
    // Verify the mount-time effect fires. Thunk-level behavior (IDB
    // read, hydrateEnrichmentFromCache dispatch) is covered in
    // packageSlice.enrich.test.ts — here we only confirm the wiring.
    const dispatched: unknown[] = [];
    const { store } = renderWithProviders(<PackageMessageTable channel={channel} />, {
      preloadedState: stateWith({
        loadedChannels: {
          '200': [
            { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'hi', attachments: [] },
          ],
        },
      }),
    });
    // Subscribe and collect actions.
    const unsubscribe = store.subscribe(() => dispatched.push(store.getState()));
    await waitFor(() => {
      // The thunk dispatches pending → fulfilled on mount; the
      // fulfilled action changes the store (at minimum it no-ops for
      // no cache, which still triggers subscribers).
      expect(dispatched.length).toBeGreaterThan(0);
    });
    unsubscribe();
  });

  it('gone rows render the "unavailable" warning chip', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'kept', attachments: [] },
          { id: '2', timestamp: '2023-01-01 00:01:00.000000+00:00', content: 'deleted by user', attachments: [] },
        ],
      },
    }) as any;
    // Message '2' is known-gone via the user's delete cache.
    base.package.deletedMessageIds = { '200': ['2'] };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    // The "unavailable" chip renders for gone rows.
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    // Original content still visible so context isn't lost.
    expect(screen.getByText('deleted by user')).toBeInTheDocument();
    expect(screen.getByText('kept')).toBeInTheDocument();
    // Header count reflects both messages, with a callout for the deleted one.
    expect(screen.getByText(/previously deleted/i)).toBeInTheDocument();
  });

  it('checkboxes on gone rows are disabled (selectable rows are not)', () => {
    // We verify `disabled` attribute directly rather than simulating a
    // click — jsdom's behavior around clicks on disabled inputs is
    // inconsistent with real browsers, and the guarantee we care about
    // is the attribute itself (which the browser enforces).
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'keep', attachments: [] },
          { id: '2', timestamp: '2023-01-01 00:01:00.000000+00:00', content: 'gone', attachments: [] },
        ],
      },
    }) as any;
    base.package.deletedMessageIds = { '200': ['2'] };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    expect(screen.getByLabelText(/Select message 2/)).toBeDisabled();
    expect(screen.getByLabelText(/Select message 1/)).not.toBeDisabled();
  });

  it('select-all uses selectable set; gone rows excluded from bulk selection', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'a', attachments: [] },
          { id: '2', timestamp: '2023-01-01 00:01:00.000000+00:00', content: 'gone', attachments: [] },
          { id: '3', timestamp: '2023-01-01 00:02:00.000000+00:00', content: 'b', attachments: [] },
        ],
      },
    }) as any;
    base.package.deletedMessageIds = { '200': ['2'] };
    const { store } = renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    const selectAll = screen.getByLabelText(/Select all messages/i);
    fireEvent.click(selectAll);
    // Only 1 and 3 get selected; 2 is gone and excluded from select-all.
    // Order follows the table's newest-first sort (by timestamp desc).
    const selected = store.getState().package.selectedMessageIds['200'] ?? [];
    expect([...selected].sort()).toEqual(['1', '3']);
    expect(selected).not.toContain('2');
  });

  it('select-all header checkbox is disabled when every row is gone', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'x', attachments: [] },
          { id: '2', timestamp: '2023-01-01 00:01:00.000000+00:00', content: 'y', attachments: [] },
        ],
      },
    }) as any;
    base.package.deletedMessageIds = { '200': ['1', '2'] };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

    const selectAll = screen.getByLabelText(/Select all messages/i);
    expect(selectAll).toBeDisabled();
  });

  it('formattingContext picks up named mentions from enriched messages', () => {
    const base = stateWith({
      loadedChannels: {
        '200': [
          {
            id: '1',
            timestamp: '2023-01-01 00:00:00.000000+00:00',
            content: 'hi <@999888777666555444>',
            attachments: [],
          },
        ],
      },
    }) as any;
    base.package.enrichmentStatus = { '200': 'done' };
    base.package.enrichmentLastFetched = { '200': Date.now() };
    base.package.enrichmentMisses = { '200': { deleted: [], forbidden: [] } };
    base.package.enrichedMessages = {
      '200': {
        '1': {
          id: '1',
          type: 0,
          content: 'hi <@999888777666555444>',
          reactions: [],
          embeds: [],
          // This mentions array is the source of the @name chip below.
          mentions: [
            {
              id: '999888777666555444',
              username: 'alice',
              global_name: 'Alice',
            },
          ],
        },
      },
    };
    renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
    const mention = document.querySelector('.user-mention');
    expect(mention?.textContent).toBe('@Alice');
  });

  describe('#271 already-gone provenance', () => {
    const twoRows = {
      '200': [
        { id: '1', timestamp: '2023-01-01 00:00:00.000000+00:00', content: 'kept', attachments: [] },
        { id: '2', timestamp: '2023-01-01 00:01:00.000000+00:00', content: 'was already gone', attachments: [] },
      ],
    };

    it('captions gone-only ids as "gone from Discord" rather than "previously deleted"', () => {
      const base = stateWith({ loadedChannels: twoRows }) as any;
      base.package.deletedMessageIds = { '200': ['2'] };
      base.package.goneMessageIds = { '200': ['2'] };
      renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

      expect(screen.getByText(/1 gone from Discord/i)).toBeInTheDocument();
      expect(screen.queryByText(/previously deleted/i)).not.toBeInTheDocument();
    });

    it('shows the all-gone delete result as a warning', () => {
      const base = stateWith({ loadedChannels: twoRows }) as any;
      base.package.deleteResult = { deleted: 0, alreadyGone: 2, forbidden: 0, failed: 0, cancelled: false, deletedIds: [], alreadyGoneIds: ['1', '2'] };
      renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });

      const alert = screen.getByText(/Nothing to delete/i).closest('[role="alert"]');
      expect(alert).toHaveClass('MuiAlert-colorWarning');
    });

    it('suggests rehydrating first on a large selection of a channel that was never rehydrated', () => {
      const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      const loadedChannels = {
        '200': ids.map((id, i) => ({ id, timestamp: `2023-01-01 00:${String(i % 60).padStart(2, '0')}:00.000000+00:00`, content: `m${i}`, attachments: [] })),
      };
      renderWithProviders(<PackageMessageTable channel={channel} />, {
        preloadedState: stateWith({ loadedChannels, selectedMessageIds: { '200': ids } }),
      });
      fireEvent.click(screen.getByRole('button', { name: /Delete selected/i }));

      expect(screen.getByTestId('package-delete-rehydrate-hint')).toHaveTextContent(/Rehydrate first to skip them/);
    });

    it('does not show the rehydrate hint for a small selection', () => {
      const base = stateWith({ loadedChannels: twoRows, selectedMessageIds: { '200': ['1', '2'] } });
      renderWithProviders(<PackageMessageTable channel={channel} />, { preloadedState: base });
      fireEvent.click(screen.getByRole('button', { name: /Delete selected/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByTestId('package-delete-rehydrate-hint')).not.toBeInTheDocument();
    });
  });
});
