import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import WelcomePanel from './WelcomePanel';

describe('WelcomePanel', () => {
  const mockOnStartTour = vi.fn();

  beforeEach(() => {
    mockOnStartTour.mockClear();
  });

  it('should render the welcome heading', () => {
    renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
    expect(screen.getByText('Welcome to Discrub')).toBeInTheDocument();
  });

  it('should render the tagline', () => {
    renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
    expect(screen.getByText(/powerful Discord data management tool/)).toBeInTheDocument();
  });

  it('should render Take a Tour button', () => {
    renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
    expect(screen.getByText('Take a Tour')).toBeInTheDocument();
  });

  it('should render Explore Features button', () => {
    renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
    expect(screen.getByText('Explore Features')).toBeInTheDocument();
  });

  it('should render Coming from v1 button', () => {
    renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
    expect(screen.getByText('Coming from Classic?')).toBeInTheDocument();
  });

  it('should call onStartTour when Take a Tour is clicked', () => {
    renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
    fireEvent.click(screen.getByText('Take a Tour'));
    expect(mockOnStartTour).toHaveBeenCalledTimes(1);
  });

  describe('GitHub affordances (#131)', () => {
    it('renders the GitHub actions cluster', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByTestId('welcome-github-actions')).toBeInTheDocument();
    });

    it('Follow button targets the dev profile and opens in a new tab', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      const followLink = screen.getByRole('link', { name: /follow on github/i });
      expect(followLink).toHaveAttribute('href', 'https://github.com/prathercc');
      expect(followLink).toHaveAttribute('target', '_blank');
      expect(followLink).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    });

    it('Star button targets the project repo and opens in a new tab', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      const starLink = screen.getByRole('link', { name: /star on github/i });
      expect(starLink).toHaveAttribute('href', expect.stringContaining('github.com/prathercc/discrub'));
      expect(starLink).toHaveAttribute('target', '_blank');
      expect(starLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });
  });

  describe('Getting Started section', () => {
    it('should render Getting Started heading', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText('Getting Started')).toBeInTheDocument();
    });

    it('should render all 4 steps', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText(/Select a server from the sidebar/)).toBeInTheDocument();
      expect(screen.getByText(/Browse channels and load messages/)).toBeInTheDocument();
      expect(screen.getByText(/Export messages in HTML, CSV, JSON/)).toBeInTheDocument();
      expect(screen.getByText(/Delete messages or remove reactions across one or multiple/)).toBeInTheDocument();
    });

    it('should render step numbers', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  describe('Feature cards section', () => {
    it('should render Features heading', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText('Features')).toBeInTheDocument();
    });

    it('should render feature cards', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText('Export')).toBeInTheDocument();
      expect(screen.getByText('Purge')).toBeInTheDocument();
      expect(screen.getByText('Search & Filter')).toBeInTheDocument();
      expect(screen.getByText('Forum Channels')).toBeInTheDocument();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Themes')).toBeInTheDocument();
      expect(screen.getByText('Status Log')).toBeInTheDocument();
      expect(screen.getByText('Pause & Resume')).toBeInTheDocument();
    });

    it('should render feature descriptions', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText(/9 presets, per-type media selection/)).toBeInTheDocument();
      expect(screen.getByText(/Multi-channel support, thread-aware discovery/)).toBeInTheDocument();
    });
  });

  describe('Coming from v1 section', () => {
    it('should render v1 migration callout', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText('Coming from Discrub Classic?')).toBeInTheDocument();
    });

    it('should render migration guide link', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      expect(screen.getByText('Read the full migration guide')).toBeInTheDocument();
    });

    it('should open onboarding guide modal when link is clicked', () => {
      renderWithProviders(<WelcomePanel onStartTour={mockOnStartTour} />);
      const link = screen.getByText('Read the full migration guide');
      fireEvent.click(link);
      expect(screen.getByText('Migration Guide')).toBeInTheDocument();
      expect(screen.getByLabelText('Close guide')).toBeInTheDocument();
    });
  });
});
