import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState, messageStateWith } from '@/test/state-factories';
import { createMockChannel, createMockMessage } from '@/test/fixtures';
import WorkspaceSwitchDialog from './WorkspaceSwitchDialog';

vi.mock('@services/discordService', () => ({ getDiscordService: vi.fn(() => ({})) }));

describe('WorkspaceSwitchDialog', () => {
  it('names the running Load All and offers Stay and Switch', () => {
    const base = createBaseState();
    const message = messageStateWith(base.message, [createMockMessage({ id: '2' }), createMockMessage({ id: '1' })]);
    const onStay = vi.fn();
    const onSwitch = vi.fn();
    renderWithProviders(<WorkspaceSwitchDialog open onStay={onStay} onSwitch={onSwitch} />, {
      preloadedState: createBaseState({
        channel: { ...base.channel, selectedChannel: createMockChannel({ id: 'c1', name: 'general' }) },
        message: { ...base.message, ...message, pagination: { ...base.message.pagination, isLoadingAll: true } },
      }),
    });
    expect(screen.getByText('Load All is running')).toBeInTheDocument();
    expect(screen.getByText('Load All is at 2 messages in #general. Switching pauses it. Resume picks it up when you come back.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-switch-stay'));
    expect(onStay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('workspace-switch-confirm'));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});
