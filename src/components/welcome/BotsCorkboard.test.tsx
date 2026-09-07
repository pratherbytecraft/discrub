import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import BotsCorkboard from './BotsCorkboard';
import { BOTS, BOT_IDEA_MAILTO, CORKBOARD_COLLAPSED_STORAGE_KEY } from './bots';
import { DEVELOPER } from './developer';

const stateGet = vi.fn();
const stateSet = vi.fn();
vi.mock('@/extension/storage', () => ({
  storage: {
    state: {
      get: (...args: unknown[]) => stateGet(...args),
      set: (...args: unknown[]) => stateSet(...args),
    },
  },
}));

describe('BotsCorkboard', () => {
  beforeEach(() => {
    stateGet.mockReset().mockResolvedValue(null);
    stateSet.mockReset().mockResolvedValue(undefined);
  });

  it('shows one bot at a time with a counted install link, starting at the first', async () => {
    renderWithProviders(<BotsCorkboard />);
    const first = BOTS[0];
    expect(await screen.findByTestId(`corkboard-bot-${first.id}`)).toBeInTheDocument();
    expect(screen.getByText(first.name)).toBeInTheDocument();
    expect(screen.getByText(first.tagline)).toBeInTheDocument();
    for (const bot of BOTS.slice(1)) {
      expect(screen.queryByTestId(`corkboard-bot-${bot.id}`)).not.toBeInTheDocument();
    }
    const install = screen.getAllByRole('link', { name: 'Add to Discord' });
    expect(install).toHaveLength(1);
    expect(install[0]).toHaveAttribute('href', 'https://pratherbytecraft.com/go/retrostat?from=discrub');
    expect(install[0]).toHaveAttribute('target', '_blank');
    expect(install[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('reaches every bot through the carousel arrows, wrapping around', async () => {
    renderWithProviders(<BotsCorkboard />);
    await screen.findByTestId(`corkboard-bot-${BOTS[0].id}`);
    for (const bot of BOTS.slice(1)) {
      fireEvent.click(screen.getByTestId('corkboard-next'));
      expect(await screen.findByTestId(`corkboard-bot-${bot.id}`)).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Add to Discord' }),
      ).toHaveAttribute('href', bot.installUrl);
    }
    fireEvent.click(screen.getByTestId('corkboard-next'));
    expect(await screen.findByTestId(`corkboard-bot-${BOTS[0].id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('corkboard-prev'));
    expect(await screen.findByTestId(`corkboard-bot-${BOTS[BOTS.length - 1].id}`)).toBeInTheDocument();
  });

  it('advances on its own every few seconds until the user takes over', async () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<BotsCorkboard />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId(`corkboard-bot-${BOTS[0].id}`)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(screen.getByTestId(`corkboard-bot-${BOTS[1].id}`)).toBeInTheDocument();
      // A manual pick pauses the rotation for a longer grace, then it
      // resumes on its own (owner ask 2026-08-31: never dead, never pushy).
      fireEvent.click(screen.getByTestId(`corkboard-dot-${BOTS[0].id}`));
      expect(screen.getByTestId(`corkboard-bot-${BOTS[0].id}`)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(19000);
      });
      expect(screen.getByTestId(`corkboard-bot-${BOTS[0].id}`)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId(`corkboard-bot-${BOTS[1].id}`)).toBeInTheDocument();
      // And once resumed, the normal cadence is back.
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(screen.getByTestId(`corkboard-bot-${BOTS[2].id}`)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the stack backs and the position counter so the slot reads as a carousel', async () => {
    renderWithProviders(<BotsCorkboard />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByTestId('corkboard-stack-back')).toHaveLength(Math.min(2, BOTS.length - 1));
    expect(screen.getByTestId('corkboard-counter')).toHaveTextContent(`1 / ${BOTS.length}`);
    fireEvent.click(screen.getByTestId('corkboard-next'));
    expect(screen.getByTestId('corkboard-counter')).toHaveTextContent(`2 / ${BOTS.length}`);
  });

  it('pauses the auto-rotate while the pointer is over the board', async () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<BotsCorkboard />);
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.mouseEnter(screen.getByTestId('corkboard-board'));
      act(() => {
        vi.advanceTimersByTime(21000);
      });
      expect(screen.getByTestId(`corkboard-bot-${BOTS[0].id}`)).toBeInTheDocument();
      fireEvent.mouseLeave(screen.getByTestId('corkboard-board'));
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(screen.getByTestId(`corkboard-bot-${BOTS[1].id}`)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('jumps straight to a bot from its dot and marks it current', async () => {
    renderWithProviders(<BotsCorkboard />);
    await screen.findByTestId(`corkboard-bot-${BOTS[0].id}`);
    const last = BOTS[BOTS.length - 1];
    fireEvent.click(screen.getByTestId(`corkboard-dot-${last.id}`));
    expect(await screen.findByTestId(`corkboard-bot-${last.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`corkboard-dot-${last.id}`)).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId(`corkboard-dot-${BOTS[0].id}`)).toHaveAttribute('aria-current', 'false');
  });

  it('shows each bot its own sticky note, strung to that bot alone', async () => {
    renderWithProviders(<BotsCorkboard />);
    await screen.findByTestId('corkboard-sticky');
    for (const bot of BOTS) {
      expect(bot.sticker).toBeTruthy();
      fireEvent.click(screen.getByTestId(`corkboard-dot-${bot.id}`));
      await screen.findByTestId(`corkboard-bot-${bot.id}`);
      expect(screen.getByTestId('corkboard-sticky')).toHaveTextContent(bot.sticker!);
      expect(screen.getByTestId(`corkboard-thread-sticky-${bot.id}-bot-${bot.id}`)).toBeInTheDocument();
      for (const other of BOTS.filter((b) => b.id !== bot.id)) {
        expect(
          screen.queryByTestId(`corkboard-thread-sticky-${other.id}-bot-${other.id}`),
        ).not.toBeInTheDocument();
      }
    }
  });

  it('shows the founders sticky note', async () => {
    renderWithProviders(<BotsCorkboard />);
    expect(await screen.findByTestId('corkboard-sticky')).toHaveTextContent(/first 100 servers/);
  });

  it('pins a note inviting bot ideas that mails the workbench address', async () => {
    renderWithProviders(<BotsCorkboard />);
    const note = await screen.findByTestId('corkboard-idea');
    expect(note).toHaveTextContent('Have an idea for a bot?');
    expect(screen.getByRole('link', { name: 'Tell me about it.' })).toHaveAttribute('href', BOT_IDEA_MAILTO);
    expect(BOT_IDEA_MAILTO).toMatch(/^mailto:workbench@pratherbytecraft\.com/);
  });

  it('pins the developer card: avatar, name, DEV tag and a Follow link, no message (#261)', async () => {
    renderWithProviders(<BotsCorkboard />);
    const card = await screen.findByTestId('corkboard-developer');
    expect(card).toHaveTextContent(DEVELOPER.name);
    expect(card).toHaveTextContent('DEV');
    // The handle appears once, inside the Follow link; no separate @handle line.
    expect(card.textContent?.match(/@prathercc/g)).toHaveLength(1);
    expect(card).not.toHaveTextContent('building Discrub');
    const photo = screen.getByRole('img', { name: `${DEVELOPER.name}'s avatar` });
    // Bundled asset, never a github.com fetch at launch.
    expect(photo.getAttribute('src')).not.toMatch(/github/);
    const follow = screen.getByRole('link', { name: `Follow @${DEVELOPER.handle}` });
    expect(follow).toHaveAttribute('href', 'https://github.com/prathercc');
    expect(follow).toHaveAttribute('target', '_blank');
    expect(follow).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('strings the founders note to the Retrostat card with a thread', async () => {
    renderWithProviders(<BotsCorkboard />);
    await screen.findByTestId('corkboard-sticky');
    expect(screen.getByTestId('corkboard-thread-sticky-retrostat-bot-retrostat')).toBeInTheDocument();
    // The idea note is general, so it hangs on its own.
    expect(screen.queryByTestId('corkboard-thread-corkboard-idea-bot-retrostat')).not.toBeInTheDocument();
  });

  it('never uses the reserved Discord words "verified" or "certified"', async () => {
    renderWithProviders(<BotsCorkboard />);
    const board = await screen.findByTestId('bots-corkboard');
    expect(board.textContent).not.toMatch(/verified|certified/i);
  });

  it('collapses on the chevron and persists the folded state', async () => {
    renderWithProviders(<BotsCorkboard />);
    await screen.findByTestId('corkboard-bot-retrostat');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the board' }));
    expect(stateSet).toHaveBeenCalledWith(CORKBOARD_COLLAPSED_STORAGE_KEY, true);
    await waitFor(() => expect(screen.queryByTestId('corkboard-bot-retrostat')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Show the board' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts folded when the persisted flag is set and stays folded', async () => {
    stateGet.mockResolvedValue(true);
    renderWithProviders(<BotsCorkboard />);
    await waitFor(() => expect(stateGet).toHaveBeenCalledWith(CORKBOARD_COLLAPSED_STORAGE_KEY));
    expect(screen.getByRole('button', { name: 'Show the board' })).toBeInTheDocument();
    expect(screen.queryByTestId('corkboard-bot-retrostat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show the board' }));
    expect(stateSet).toHaveBeenCalledWith(CORKBOARD_COLLAPSED_STORAGE_KEY, false);
    expect(await screen.findByTestId('corkboard-bot-retrostat')).toBeInTheDocument();
  });
});
