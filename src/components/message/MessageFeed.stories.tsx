import type { Meta, StoryObj } from '@storybook/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import theme from '@theme/theme';
import { createMockStore } from '../../../.storybook/storybook-utils';
import { defaultSettings } from '@features/app/appSlice';
import MessageFeed from './MessageFeed';

const mockUsers: Record<string, any> = {
  'user-1': { id: 'user-1', username: 'alice', global_name: 'Alice', discriminator: '0001', avatar: null },
  'user-2': { id: 'user-2', username: 'bob', global_name: 'Bob', discriminator: '0002', avatar: null },
  'user-3': { id: 'user-3', username: 'charlie', global_name: 'Charlie', discriminator: '0003', avatar: null },
};

const baseChannel = { id: 'ch-1', type: 0, guild_id: 'g-1', name: 'general', position: 0 };

// Same-author burst — should collapse into one chunk with a single header
const chunkedMessages = [
  {
    id: 'msg-1', channel_id: 'ch-1', author: mockUsers['user-1'],
    content: 'Hey everyone, how is the project going?',
    timestamp: '2026-02-28T10:00:00.000Z',
    type: 0, attachments: [], embeds: [], reactions: [], mentions: [], pinned: false,
  },
  {
    id: 'msg-2', channel_id: 'ch-1', author: mockUsers['user-1'],
    content: 'I finished the feature earlier today',
    timestamp: '2026-02-28T10:02:00.000Z',
    type: 0, attachments: [], embeds: [], reactions: [], mentions: [], pinned: false,
  },
  {
    id: 'msg-3', channel_id: 'ch-1', author: mockUsers['user-1'],
    content: 'Deploying soon.',
    timestamp: '2026-02-28T10:05:00.000Z',
    type: 0, attachments: [], embeds: [], reactions: [], mentions: [], pinned: false,
  },
  {
    id: 'msg-4', channel_id: 'ch-1', author: mockUsers['user-2'],
    content: 'Nice! Looking forward to trying it out.',
    timestamp: '2026-02-28T10:07:00.000Z',
    type: 0, attachments: [], embeds: [],
    reactions: [{ emoji: { id: null, name: '👍' }, count: 2, me: false }],
    mentions: [], pinned: false,
  },
];

// Long content to demonstrate Show more collapse
const withLongContent = [
  {
    id: 'long-1', channel_id: 'ch-1', author: mockUsers['user-3'],
    content: Array(20).fill('This is a very long message that should be collapsed behind a Show more affordance.').join(' '),
    timestamp: '2026-02-28T10:00:00.000Z',
    type: 0, attachments: [], embeds: [], reactions: [], mentions: [], pinned: false,
  },
];

// Rich media — inline attachments + embeds + reactions
const withRichMedia = [
  {
    id: 'rich-1', channel_id: 'ch-1', author: mockUsers['user-2'],
    content: 'Check out this screenshot',
    timestamp: '2026-02-28T10:00:00.000Z',
    type: 0,
    attachments: [
      {
        id: 'att-1', filename: 'preview.png', size: 152400,
        url: 'https://placehold.co/400x250/7289da/ffffff?text=Attachment+preview',
        proxy_url: 'https://placehold.co/400x250/7289da/ffffff?text=Attachment+preview',
        content_type: 'image/png', width: 400, height: 250,
      },
    ],
    embeds: [], reactions: [], mentions: [], pinned: false,
  },
  {
    id: 'rich-2', channel_id: 'ch-1', author: mockUsers['user-3'],
    content: 'The docs live here',
    timestamp: '2026-02-28T10:02:00.000Z',
    type: 0, attachments: [],
    embeds: [
      {
        title: 'Documentation',
        description: 'Project documentation with examples, tutorials, and API references.',
        url: 'https://example.com/docs',
        color: 7506394,
      },
    ],
    reactions: [
      { emoji: { id: null, name: '❤️' }, count: 4, me: true },
      { emoji: { id: null, name: '👀' }, count: 1, me: false },
    ],
    mentions: [], pinned: false,
  },
];

const formattingContext = { userMap: {}, channelMap: {}, guildRoles: [] } as any;

const buildDecorator = (messages: any[]) => (Story: any) => {
  const store = createMockStore({
    message: {
      messages, filteredMessages: messages, selectedMessages: [],
      searchCriteria: null, order: { order: 'DESCENDING', orderBy: 'timestamp' },
      isLoading: false, error: null,
      pagination: { lastMessageId: null, hasMore: false, totalCount: messages.length, isLoadingMore: false, isLoadingAll: false, loadAllProgress: null, mode: 'all' },
    },
    channel: { channels: [baseChannel], selectedChannel: baseChannel, isLoading: false, error: null },
    auth: { token: 'fake-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
    app: { settings: defaultSettings, isPaused: false, isCancelled: false, currentTask: null },
  });
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div style={{ height: '90vh' }}>
          <Story />
        </div>
      </ThemeProvider>
    </Provider>
  );
};

const meta: Meta<typeof MessageFeed> = {
  title: 'Message/MessageFeed',
  component: MessageFeed,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof MessageFeed>;

export const Empty: Story = {
  args: { formattingContext, fullUserMap: {} },
  decorators: [buildDecorator([])],
};

export const ChunkedConversation: Story = {
  args: { formattingContext, fullUserMap: mockUsers },
  decorators: [buildDecorator(chunkedMessages)],
};

export const LongContent: Story = {
  args: { formattingContext, fullUserMap: mockUsers },
  decorators: [buildDecorator(withLongContent)],
};

export const WithRichMedia: Story = {
  args: { formattingContext, fullUserMap: mockUsers },
  decorators: [buildDecorator(withRichMedia)],
};
