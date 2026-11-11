import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent } from '@storybook/test';
import BulkEditDialog from './BulkEditDialog';
import { createMockChannel, createMockDmChannel } from '../../test/fixtures';

const meta: Meta<typeof BulkEditDialog> = {
  title: 'Modals/BulkEditDialog',
  component: BulkEditDialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      story: { inline: false, height: '760px' },
      description: {
        component:
          'Multi-channel "Edit Messages" dialog (#215). Overwrites every message the current user authored across the selected channels/DMs with a single fixed content string, or with random words, sentences or characters generated per message id from a saved seed. The author is locked to self (Discord only permits editing your own messages); the optional filter narrows by date or content.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof BulkEditDialog>;

const channels = [
  createMockChannel({ id: 'c1', name: 'general' }),
  createMockChannel({ id: 'c2', name: 'dev-chat' }),
];

const manyChannels = Array.from({ length: 8 }, (_, i) =>
  createMockChannel({ id: `c${i}`, name: `channel-${i + 1}` }),
);

const dms = [
  createMockDmChannel({ id: 'd1' }),
  createMockDmChannel({ id: 'd2' }),
];

const baseArgs = { open: true, onClose: () => {} };

export const Channels: Story = {
  args: { ...baseArgs, channels, mode: 'channels', guildId: 'g1' },
};

export const ManyChannels: Story = {
  args: { ...baseArgs, channels: manyChannels, mode: 'channels', guildId: 'g1' },
};

export const DirectMessages: Story = {
  args: { ...baseArgs, channels: dms, mode: 'dms', guildId: null },
};

/** Fixed text is the default; the mode field switches the dialog to random text. */
export const RandomWords: Story = {
  args: { ...baseArgs, channels, mode: 'channels', guildId: 'g1' },
  play: async () => {
    await userEvent.click(await within(document.body).findByRole('button', { name: 'Random words' }));
  },
};
