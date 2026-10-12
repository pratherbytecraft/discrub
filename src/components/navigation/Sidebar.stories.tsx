import type { Meta, StoryObj } from '@storybook/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import theme from '@theme/theme';
import { createMockStore } from '../../../.storybook/storybook-utils';
import { defaultSettings } from '@features/app/appSlice';
import Sidebar from './Sidebar';

const mockGuilds = [
  { id: 'g-1', name: 'My Server', icon: null, owner: false },
  { id: 'g-2', name: 'Gaming Hub', icon: null, owner: false },
  { id: 'g-3', name: 'Dev Community', icon: null, owner: true },
];

const mockDMs = [
  {
    id: 'dm-1',
    type: 1,
    recipients: [{ id: 'u1', username: 'alice', discriminator: '0001', avatar: null }],
    name: null,
  },
  {
    id: 'dm-2',
    type: 1,
    recipients: [{ id: 'u2', username: 'bob', discriminator: '0002', avatar: null }],
    name: null,
  },
  {
    id: 'dm-3',
    type: 1,
    recipients: [{ id: 'u3', username: 'charlie', discriminator: '0003', avatar: null }],
    name: null,
  },
];

const meta: Meta<typeof Sidebar> = {
  title: 'Navigation/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;

type Story = StoryObj<typeof Sidebar>;

export const Default: Story = {
  args: {
    open: true,
  },
};

export const Closed: Story = {
  args: {
    open: false,
  },
};

export const WithCopyButtons: Story = {
  args: {
    open: true,
  },
  decorators: [
    (Story) => {
      const store = createMockStore({
        auth: { token: 'fake-token', isAuthenticated: true, isLoading: false, error: null, manuallyLoggedOut: false, isRestoring: false, tokenRemembered: false, guestMode: false },
        guild: {
          guilds: mockGuilds,
          selectedGuild: null,
          isLoading: false,
          error: null,
        },
        dm: {
          dms: mockDMs,
          selectedDm: null,
          selectedDms: [],
          isLoading: false,
          error: null,
        },
        app: { settings: defaultSettings, isPaused: false, isCancelled: false, currentTask: null },
      });
      return (
        <Provider store={store}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <Story />
          </ThemeProvider>
        </Provider>
      );
    },
  ],
};
