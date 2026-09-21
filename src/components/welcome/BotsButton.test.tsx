import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import BotsButton from './BotsButton';
import { BOTS, BOT_IDEA_MAILTO } from './bots';
import { DEVELOPER } from './developer';

describe('BotsButton', () => {
  it('shows the word by default and only the icon when asked', () => {
    const { unmount } = renderWithProviders(<BotsButton />);
    expect(screen.getByTestId('bots-button')).toHaveTextContent('Bots');
    unmount();
    renderWithProviders(<BotsButton label={false} />);
    expect(screen.getByTestId('bots-button')).not.toHaveTextContent('Bots');
    expect(screen.getByLabelText('Bots')).toBeInTheDocument();
  });

  it('opens a list with every bot, its install link and its page', () => {
    renderWithProviders(<BotsButton />);
    expect(screen.queryByTestId('bots-popover')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bots-button'));
    expect(screen.getByText('Bots From The Developer')).toBeInTheDocument();
    for (const bot of BOTS) {
      expect(screen.getByTestId(`bots-row-${bot.id}`)).toHaveTextContent(bot.name);
      expect(screen.getByTestId(`bots-row-${bot.id}`)).toHaveTextContent(bot.tagline);
      const add = screen.getByTestId(`bots-add-${bot.id}`);
      expect(add).toHaveAttribute('href', expect.stringContaining(`/go/${bot.id}?from=discrub-bots-menu`));
      expect(add).toHaveAttribute('target', '_blank');
      expect(screen.getByTestId(`bots-learn-${bot.id}`)).toHaveAttribute('href', bot.pageUrl);
    }
  });

  it('carries the follow link and the bot idea address, and no founder note', () => {
    renderWithProviders(<BotsButton />);
    fireEvent.click(screen.getByTestId('bots-button'));
    expect(screen.getByTestId('bots-follow')).toHaveAttribute('href', DEVELOPER.profileUrl);
    expect(screen.getByTestId('bots-follow')).toHaveTextContent(`Follow @${DEVELOPER.handle}`);
    expect(screen.getByTestId('bots-idea')).toHaveAttribute('href', BOT_IDEA_MAILTO);
    expect(screen.getByTestId('bots-popover')).not.toHaveTextContent(/founder/i);
  });

  it('leaves the bar on a phone when asked, so a Scrubling keeps the slot', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: /max-width/.test(query), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      const { unmount } = renderWithProviders(<BotsButton label={false} hideOnPhone />);
      expect(screen.queryByTestId('bots-button')).not.toBeInTheDocument();
      unmount();
      renderWithProviders(<BotsButton label={false} />);
      expect(screen.getByTestId('bots-button')).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });
});
