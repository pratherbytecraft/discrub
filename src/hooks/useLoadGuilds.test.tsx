import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, waitFor } from '@/test/test-utils';
import { createAuthenticatedState, createBaseState } from '@/test/state-factories';
import { initialGuildState } from '@features/guild/guildTypes';
import { useLoadGuilds } from './useLoadGuilds';

const { mockFetchGuilds } = vi.hoisted(() => ({ mockFetchGuilds: vi.fn() }));
vi.mock('@services/discordService', () => ({
  getDiscordService: vi.fn(() => ({ fetchGuilds: mockFetchGuilds })),
}));

const Probe = () => { useLoadGuilds(); return null; };

describe('useLoadGuilds', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('loads the servers once for a signed-in user with none yet, from any surface that mounts it', async () => {
    mockFetchGuilds.mockResolvedValue({ success: true, data: [{ id: 'g1', name: 'One' }] });
    // Two surfaces at once (a rail and a list) still make one request.
    const { store } = renderWithProviders(<><Probe /><Probe /></>, { preloadedState: createAuthenticatedState({ guild: { ...initialGuildState } }) as never });
    await waitFor(() => expect(store.getState().guild.guilds).toHaveLength(1));
    expect(mockFetchGuilds).toHaveBeenCalledTimes(1);
  });

  it('does nothing signed out', () => {
    renderWithProviders(<Probe />, { preloadedState: createBaseState() as never });
    expect(mockFetchGuilds).not.toHaveBeenCalled();
  });
});
