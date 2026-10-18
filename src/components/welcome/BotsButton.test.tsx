import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import BotsButton from './BotsButton';
import { BOTS, BOT_IDEA_MAILTO } from './bots';
import { DEVELOPER } from './developer';
import { MAC_APPS } from './macApps';
import { MAC_APPS_HIDDEN_KEY, MAC_APPS_SEEN_KEY, resetMacAppsPromo } from './macAppsPromo';
import { storage } from '@/extension/storage';

const macMock = vi.hoisted(() => ({ mac: false }));
vi.mock('@/utils/platform', () => ({ isMacOS: () => macMock.mac }));

describe('BotsButton', () => {
  beforeEach(async () => {
    macMock.mac = false;
    resetMacAppsPromo();
    await storage.state.clear();
  });

  it('shows the word by default and only the icon when asked', () => {
    const { unmount } = renderWithProviders(<BotsButton />);
    expect(screen.getByTestId('bots-button')).toHaveTextContent('Apps');
    unmount();
    renderWithProviders(<BotsButton label={false} />);
    expect(screen.getByTestId('bots-button')).not.toHaveTextContent('Apps');
    expect(screen.getByLabelText('Apps')).toBeInTheDocument();
  });

  it('opens a list with every bot, its install link and its page', () => {
    renderWithProviders(<BotsButton />);
    expect(screen.queryByTestId('bots-popover')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bots-button'));
    expect(screen.getByText('Apps From The Developer')).toBeInTheDocument();
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

  // mac-apps-promo (2.2.6): the For Mac section, the dot and Hide.
  describe('For Mac section', () => {
    it('stays out of the menu off a Mac, with no dot', async () => {
      renderWithProviders(<BotsButton />);
      fireEvent.click(screen.getByTestId('bots-button'));
      await screen.findByTestId('bots-popover');
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByTestId('apps-mac-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('apps-dot')).not.toBeInTheDocument();
    });

    it('lists Startbar and Filedrawer on a Mac with a page link each, and opening clears the dot', async () => {
      macMock.mac = true;
      renderWithProviders(<BotsButton />);
      expect(await screen.findByTestId('apps-dot')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('bots-button'));
      expect(await screen.findByTestId('apps-mac-section')).toBeInTheDocument();
      for (const app of MAC_APPS) {
        expect(screen.getByTestId(`apps-row-${app.id}`)).toHaveTextContent(app.name);
        expect(screen.getByTestId(`apps-row-${app.id}`)).toHaveTextContent(app.tagline);
        expect(screen.getByTestId(`apps-get-${app.id}`)).toHaveAttribute('href', app.pageUrl);
        expect(screen.getByTestId(`apps-learn-${app.id}`)).toHaveAttribute('href', app.pageUrl);
      }
      expect(screen.getByText('Discord bots')).toBeInTheDocument();
      expect(screen.queryByTestId('apps-dot')).not.toBeInTheDocument();
      await vi.waitFor(async () => expect(await storage.state.get<boolean>(MAC_APPS_SEEN_KEY)).toBe(true));
    });

    it('shows no dot when the menu was opened before', async () => {
      macMock.mac = true;
      await storage.state.set(MAC_APPS_SEEN_KEY, true);
      renderWithProviders(<BotsButton />);
      fireEvent.click(screen.getByTestId('bots-button'));
      expect(await screen.findByTestId('apps-mac-section')).toBeInTheDocument();
      expect(screen.queryByTestId('apps-dot')).not.toBeInTheDocument();
    });

    it('Hide drops the section for good', async () => {
      macMock.mac = true;
      renderWithProviders(<BotsButton />);
      fireEvent.click(screen.getByTestId('bots-button'));
      fireEvent.click(await screen.findByTestId('apps-mac-hide'));
      expect(screen.queryByTestId('apps-mac-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('bots-row-retrostat')).toBeInTheDocument();
      await vi.waitFor(async () => expect(await storage.state.get<boolean>(MAC_APPS_HIDDEN_KEY)).toBe(true));
    });

    it('stays hidden after Hide on a fresh load', async () => {
      macMock.mac = true;
      await storage.state.set(MAC_APPS_HIDDEN_KEY, true);
      renderWithProviders(<BotsButton />);
      fireEvent.click(screen.getByTestId('bots-button'));
      await screen.findByTestId('bots-popover');
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByTestId('apps-mac-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('apps-dot')).not.toBeInTheDocument();
    });
  });
});
