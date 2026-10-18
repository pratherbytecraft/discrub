import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import WelcomePanel from './WelcomePanel';

describe('WelcomePanel', () => {
  it('should render the welcome heading', () => {
    renderWithProviders(<WelcomePanel />);
    expect(screen.getByText('Welcome to Discrub')).toBeInTheDocument();
  });

  it('should render the tagline', () => {
    renderWithProviders(<WelcomePanel />);
    expect(screen.getByText(/powerful Discord data management tool/)).toBeInTheDocument();
  });

  it('no longer carries the bots board, which moved to the Bots button on the top bar', () => {
    renderWithProviders(<WelcomePanel />);
    expect(screen.queryByTestId('bots-corkboard')).not.toBeInTheDocument();
    expect(screen.queryByText(/become a founder/i)).not.toBeInTheDocument();
  });

  it('no longer offers a guided tour (removed in 2.2.6)', () => {
    renderWithProviders(<WelcomePanel />);
    expect(screen.queryByText('Take a Tour')).not.toBeInTheDocument();
  });

  it('should render Explore Features button', () => {
    renderWithProviders(<WelcomePanel />);
    expect(screen.getByText('Explore Features')).toBeInTheDocument();
  });

  it('should render Coming from v1 button', () => {
    renderWithProviders(<WelcomePanel />);
    expect(screen.getByText('Coming from Classic?')).toBeInTheDocument();
  });

  describe('GitHub affordances (#131)', () => {
    it('renders the GitHub actions cluster', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByTestId('welcome-github-actions')).toBeInTheDocument();
    });

    it('no longer crowds the action row with a Follow button (it lives in the Bots menu and on the What\'s New dialog)', () => {
      renderWithProviders(<WelcomePanel />);
      const cluster = screen.getByTestId('welcome-github-actions');
      expect(cluster.querySelectorAll('a')).toHaveLength(1);
      expect(cluster).not.toHaveTextContent(/follow on github/i);
    });

    it('Star button targets the project repo and opens in a new tab', () => {
      renderWithProviders(<WelcomePanel />);
      const starLink = screen.getByRole('link', { name: /star on github/i });
      expect(starLink).toHaveAttribute('href', expect.stringContaining('github.com/prathercc/discrub'));
      expect(starLink).toHaveAttribute('target', '_blank');
      expect(starLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });
  });

  describe('Getting Started section', () => {
    it('should render Getting Started heading', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText('Getting Started')).toBeInTheDocument();
    });

    it('should render all 4 steps', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText(/Select a server from the sidebar/)).toBeInTheDocument();
      expect(screen.getByText(/Browse channels and load messages/)).toBeInTheDocument();
      expect(screen.getByText(/Export messages in HTML, CSV, JSON/)).toBeInTheDocument();
      expect(screen.getByText(/Delete messages or remove reactions across one or multiple/)).toBeInTheDocument();
    });

    it('should render step numbers', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  describe('Feature cards section', () => {
    it('should render Features heading', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText('Features')).toBeInTheDocument();
    });

    it('should render all 10 feature cards', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText('Export')).toBeInTheDocument();
      expect(screen.getByText('Purge')).toBeInTheDocument();
      expect(screen.getByText('Search & Filter')).toBeInTheDocument();
      expect(screen.getByText('Forum Channels')).toBeInTheDocument();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Themes')).toBeInTheDocument();
      expect(screen.getByText('Status Log')).toBeInTheDocument();
      expect(screen.getByText('Pause & Resume')).toBeInTheDocument();
      expect(screen.getByText('Supporter Wall')).toBeInTheDocument();
    });

    it('should render feature descriptions', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText(/9 presets, per-type media selection/)).toBeInTheDocument();
      expect(screen.getByText(/Multi-channel support, thread-aware discovery/)).toBeInTheDocument();
    });
  });

  describe('Coming from v1 section', () => {
    it('should render v1 migration callout', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText('Coming from Discrub Classic?')).toBeInTheDocument();
    });

    it('should render migration guide link', () => {
      renderWithProviders(<WelcomePanel />);
      expect(screen.getByText('Read the full migration guide')).toBeInTheDocument();
    });

    it('should open onboarding guide modal when link is clicked', () => {
      renderWithProviders(<WelcomePanel />);
      const link = screen.getByText('Read the full migration guide');
      fireEvent.click(link);
      expect(screen.getByText('Migration Guide')).toBeInTheDocument();
      expect(screen.getByLabelText('Close guide')).toBeInTheDocument();
    });
  });
});
