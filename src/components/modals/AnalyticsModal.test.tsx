import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, within } from '../../test/test-utils';
import AnalyticsModal from './AnalyticsModal';
import { createBaseState } from '../../test/state-factories';
import type { Message } from 'discrub-core/types/discord-types';

vi.mock('@/extension/storage', () => {
  function makeAdapter() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      getMany: vi.fn().mockResolvedValue([]),
      setMany: vi.fn().mockResolvedValue(undefined),
      entries: vi.fn().mockResolvedValue([]),
    };
  }
  return {
    storage: {
      settings: makeAdapter(),
      state: makeAdapter(),
      presets: makeAdapter(),
      cache: makeAdapter(),
      history: makeAdapter(),
      statuslog: makeAdapter(),
      package: makeAdapter(),
      media: makeAdapter(),
    },
    migrateAllStorage: vi.fn().mockResolvedValue(undefined),
  };
});

let nextId = 1;
const createMessage = (content: string, type = 0, extra: Partial<Message> = {}): Message =>
  ({
    id: String(nextId++),
    channel_id: 'chan',
    content,
    type,
    timestamp: '2026-08-10T15:00:00.000Z',
    author: { id: '111', username: 'alice', discriminator: '0', global_name: 'Alice' },
    attachments: [],
    embeds: [],
    ...extra,
  }) as Message;

const userMap = {
  '111': { userName: 'Alice', displayName: 'Alice Display', nick: undefined },
  '222': { userName: 'Bob', displayName: undefined, nick: 'Bobby' },
};

const render = (messages: Message[], props: Partial<React.ComponentProps<typeof AnalyticsModal>> = {}) =>
  renderWithProviders(
    <AnalyticsModal open={true} onClose={mockOnClose} messages={messages} userMap={userMap} {...props} />,
    { preloadedState: createBaseState() },
  );

const openTab = (label: string) => fireEvent.click(screen.getByRole('tab', { name: label }));

const mockOnClose = vi.fn();

describe('AnalyticsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens on the Mentions report with the report title', () => {
    render([createMessage('<@111> hello')]);
    expect(screen.getByTestId('analytics-title')).toHaveTextContent('Most mentioned');
    expect(screen.getByRole('tab', { name: 'Mentions', selected: true })).toBeInTheDocument();
  });

  it('shows one tab per report', () => {
    render([createMessage('hi')]);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Mentions', 'Members', 'Reactions', 'Best Of', 'Threads', 'Keywords', 'Links', 'Media', 'Overview']);
  });

  it('should display mention count and message count', () => {
    render([createMessage('<@111> and <@222>'), createMessage('<@111> again')]);
    expect(screen.getByText(/3 mentions across 2 messages/)).toBeInTheDocument();
  });

  it('should render sortable table with username and mention count columns', () => {
    render([createMessage('<@111>')]);
    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('Mentions', { selector: 'span' })).toBeInTheDocument();
  });

  it('should display resolved usernames from userMap', () => {
    render([createMessage('<@111> <@222>')]);
    expect(screen.getByText('Alice Display')).toBeInTheDocument();
    expect(screen.getByText('Bobby')).toBeInTheDocument();
  });

  it('should sort by count descending by default', () => {
    render([createMessage('<@222> <@222> <@222>'), createMessage('<@111>')]);
    const rows = screen.getAllByTestId('analytics-row');
    expect(rows[0]).toHaveTextContent('Bobby');
    expect(rows[1]).toHaveTextContent('Alice Display');
  });

  it('should toggle sort direction when clicking column header', () => {
    render([createMessage('<@222> <@222> <@222>'), createMessage('<@111>')]);
    fireEvent.click(screen.getByText('Mentions', { selector: 'span' }));
    const rows = screen.getAllByTestId('analytics-row');
    expect(rows[0]).toHaveTextContent('Alice Display');
  });

  it('should sort by username when clicking Username header', () => {
    render([createMessage('<@222> <@222> <@222>'), createMessage('<@111>')]);
    fireEvent.click(screen.getByText('Username'));
    const rows = screen.getAllByTestId('analytics-row');
    expect(rows[0]).toHaveTextContent('Alice Display');
    expect(rows[1]).toHaveTextContent('Bobby');
  });

  it('should show empty state when no mentions found', () => {
    render([createMessage('no mentions here')]);
    expect(screen.getByText('No mentions found')).toBeInTheDocument();
  });

  it('should show Export CSV button only when there are rows', () => {
    const { unmount } = render([createMessage('<@111>')]);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
    unmount();
    render([createMessage('nothing')]);
    expect(screen.queryByText('Export CSV')).not.toBeInTheDocument();
  });

  it('should call onClose when close button clicked', () => {
    render([createMessage('<@111>')]);
    fireEvent.click(screen.getByLabelText('Close analytics'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should not render when open is false', () => {
    renderWithProviders(
      <AnalyticsModal open={false} onClose={mockOnClose} messages={[createMessage('<@111>')]} userMap={userMap} />,
      { preloadedState: createBaseState() },
    );
    expect(screen.queryByTestId('analytics-title')).not.toBeInTheDocument();
  });

  it('should handle singular mention and message correctly', () => {
    render([createMessage('<@111>')]);
    expect(screen.getByText(/1 mention across 1 message$/)).toBeInTheDocument();
  });

  it('should exclude reply messages when skip replies is checked (Mentions only)', () => {
    render([createMessage('<@111> hello', 0), createMessage('<@111> <@222> reply mention', 19), createMessage('<@222> another', 0)]);
    expect(screen.getByText(/4 mentions across 3 messages/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Skip replies'));
    expect(screen.getByText(/2 mentions across 2 messages/)).toBeInTheDocument();
    expect(screen.getByText(/1 replies excluded/)).toBeInTheDocument();

    openTab('Members');
    expect(screen.queryByText('Skip replies')).not.toBeInTheDocument();
    // Members counts every post again, replies included.
    expect(screen.getByTestId('analytics-row')).toHaveTextContent('3');
  });

  it('should trigger CSV download on Export CSV click', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    const mockClick = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const createElement = document.createElement.bind(document);
    let downloadName = '';
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === 'a') {
        el.click = () => { downloadName = (el as HTMLAnchorElement).download; mockClick(); };
      }
      return el;
    });

    render([createMessage('<@111>')]);
    fireEvent.click(screen.getByText('Export CSV'));
    expect(createObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    expect(downloadName).toBe('mention-counts.csv');

    openTab('Members');
    fireEvent.click(screen.getByText('Export CSV'));
    expect(downloadName).toBe('analytics-members.csv');

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('shows the Retrostat nudge only when there are results', () => {
    const { unmount } = render([createMessage('hi <@111>')]);
    expect(screen.getByTestId('bot-nudge')).toBeInTheDocument();
    unmount();

    render([createMessage('no mentions')]);
    expect(screen.getByText('No mentions found')).toBeInTheDocument();
    expect(screen.queryByTestId('bot-nudge')).not.toBeInTheDocument();
  });

  describe('other reports', () => {
    const reacted = (content: string, counts: [string, number][], extra: Partial<Message> = {}) =>
      createMessage(content, 0, { reactions: counts.map(([name, count]) => ({ count, emoji: { id: null, name } })) as Message['reactions'], ...extra });

    it('Best Of lists reacted messages with excerpt and emoji breakdown', () => {
      render([reacted('a great post', [['🔥', 3], ['👍', 1]]), reacted('meh', [['👍', 1]])]);
      openTab('Best Of');
      expect(screen.getByTestId('analytics-title')).toHaveTextContent('Most reacted messages');
      const rows = screen.getAllByTestId('analytics-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('Alice');
      expect(rows[0]).toHaveTextContent('a great post');
      expect(rows[0]).toHaveTextContent('🔥 3 · 👍 1');
      expect(screen.getByTestId('analytics-summary')).toHaveTextContent('🔥 3 · 👍 2');
      expect(screen.getByTestId('analytics-mode')).toHaveTextContent('2+ reactions only');
    });

    it('Reactions ranks authors by reactions received', () => {
      render([reacted('x', [['🔥', 3]]), reacted('y', [['👍', 5]], { author: { id: '222', username: 'bob', discriminator: '0', global_name: null } as Message['author'] })]);
      openTab('Reactions');
      const rows = screen.getAllByTestId('analytics-row');
      expect(rows[0]).toHaveTextContent('Bobby');
      expect(rows[0]).toHaveTextContent('5');
    });

    it('Threads uses the thread names and skips the container channel', () => {
      render([createMessage('in channel'), createMessage('in thread', 0, { channel_id: 't1' }), createMessage('again', 0, { channel_id: 't1' })], {
        containerId: 'chan',
        threadNames: { t1: 'Bug reports' },
      });
      openTab('Threads');
      const rows = screen.getAllByTestId('analytics-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('Bug reports');
      expect(rows[0]).toHaveTextContent('1 person');
      expect(rows[0]).toHaveTextContent('2');
    });

    it('Keywords asks for terms, then counts them as typed', () => {
      render([createMessage('the app crashed'), createMessage('login is fine'), createMessage('CRASH again')]);
      openTab('Keywords');
      expect(screen.getByTestId('analytics-empty')).toHaveTextContent(/terms/i);
      fireEvent.change(screen.getByTestId('analytics-terms'), { target: { value: 'crash, login' } });
      const rows = screen.getAllByTestId('analytics-row');
      expect(rows[0]).toHaveTextContent('crash');
      expect(rows[0]).toHaveTextContent('2');
      expect(rows[1]).toHaveTextContent('login');
      expect(screen.getByTestId('analytics-summary')).toHaveTextContent('3 messages mention at least one term');
    });

    it('Links counts domains', () => {
      render([createMessage('see https://www.youtube.com/a'), createMessage('and https://youtube.com/b plus https://github.com/c')]);
      openTab('Links');
      const rows = screen.getAllByTestId('analytics-row');
      expect(rows[0]).toHaveTextContent('youtube.com');
      expect(rows[0]).toHaveTextContent('2');
      expect(rows[1]).toHaveTextContent('github.com');
      expect(screen.getByTestId('analytics-summary')).toHaveTextContent('2 messages with links · 2 domains');
    });

    it('Media counts attachments with a kind breakdown', () => {
      render([createMessage('pic', 0, { attachments: [{ filename: 'a.png', content_type: 'image/png' }, { filename: 'notes.txt' }] as Message['attachments'] })]);
      openTab('Media');
      expect(screen.getByTestId('analytics-row')).toHaveTextContent('2');
      expect(screen.getByTestId('analytics-summary')).toHaveTextContent('2 total: 1 image, 0 videos, 1 other');
    });

    it('Overview shows the headline tiles, top emoji and the most reacted message', () => {
      render([reacted('best one', [['🔥', 4]]), createMessage('reply', 19), createMessage('thread msg', 0, { channel_id: 't1' })], { containerId: 'chan' });
      openTab('Overview');
      const card = screen.getByTestId('analytics-overview');
      expect(within(card).getByText('Messages').nextSibling).toHaveTextContent('3');
      expect(within(card).getByText('People').nextSibling).toHaveTextContent('1');
      expect(within(card).getByText('Reactions').nextSibling).toHaveTextContent('4');
      expect(within(card).getByText('Replies').nextSibling).toHaveTextContent('1');
      expect(within(card).getByText('Threads').nextSibling).toHaveTextContent('1');
      expect(within(card).getByText('Busiest day')).toBeInTheDocument();
      expect(within(card).getByText('Peak hour')).toBeInTheDocument();
      expect(screen.getByTestId('analytics-top-emoji')).toHaveTextContent('🔥 4');
      expect(screen.getByTestId('analytics-best')).toHaveTextContent('Alice Display · 4 reactions · best one');
      // Top posters table under the card
      expect(screen.getByText('Top posters')).toBeInTheDocument();
      expect(screen.getByTestId('bot-nudge')).toBeInTheDocument();
    });

    it('shows a per-report empty state and no export button', () => {
      render([createMessage('plain text')]);
      openTab('Links');
      expect(screen.getByTestId('analytics-empty')).toHaveTextContent('No links in this feed.');
      expect(screen.queryByText('Export CSV')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bot-nudge')).not.toBeInTheDocument();
    });

    it('honours initialReport', () => {
      render([createMessage('x')], { initialReport: 'members' });
      expect(screen.getByRole('tab', { name: 'Members', selected: true })).toBeInTheDocument();
      expect(screen.getByTestId('analytics-title')).toHaveTextContent('Most active members');
    });
  });
});
