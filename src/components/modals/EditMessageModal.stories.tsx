import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent } from '@storybook/test';
import EditMessageModal from './EditMessageModal';

const meta: Meta<typeof EditMessageModal> = {
  title: 'Modals/EditMessageModal',
  component: EditMessageModal,
  tags: ['autodocs'],
  parameters: {
    docs: {
      story: { inline: false, height: '500px' },
      description: {
        component:
          'Edit one message (prefilled with its content) or several at once. Fixed text keeps the field content; random words, sentences or characters replace each message with text generated from its id and a saved seed, so retries and resumes stay stable.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof EditMessageModal>;

const mockMessage = {
  id: 'msg-1',
  content: 'Hello, this is a message I want to edit!',
  author: { id: 'u1', username: 'testuser', discriminator: '0001', avatar: null },
  timestamp: '2024-01-15T10:00:00Z',
} as any;

export const Default: Story = {
  args: {
    open: true,
    message: mockMessage,
    messageCount: 1,
    onSave: (content: string) => alert(`Saved: ${content}`),
    onClose: () => {},
  },
};

export const LongContent: Story = {
  args: {
    open: true,
    message: {
      ...mockMessage,
      content: 'This is a much longer message that contains multiple paragraphs.\n\nIt includes line breaks and various formatting.\n\nThe user should be able to edit all of this content freely.',
    },
    messageCount: 1,
    onSave: () => {},
    onClose: () => {},
  },
};

export const BulkEdit: Story = {
  args: {
    open: true,
    message: null,
    messageCount: 5,
    onSave: (content: string) => alert(`Bulk saved: ${content}`),
    onClose: () => {},
  },
};

/** Fixed text is the default; the mode field switches the dialog to random text. */
export const RandomWords: Story = {
  args: {
    open: true,
    message: mockMessage,
    messageCount: 1,
    onSave: () => {},
    onClose: () => {},
  },
  play: async () => {
    await userEvent.click(await within(document.body).findByRole('button', { name: 'Random words' }));
  },
};
