import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResetDiscrubButton from './ResetDiscrubButton';

vi.mock('@/extension/storage', () => ({
  resetDiscrubData: vi.fn().mockResolvedValue(undefined),
}));

import { resetDiscrubData } from '@/extension/storage';
const mockReset = resetDiscrubData as unknown as ReturnType<typeof vi.fn>;

describe('ResetDiscrubButton', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReset.mockClear();
    mockReset.mockResolvedValue(undefined);

    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('link variant (LandingPage)', () => {
    it('renders the "Stuck? Reset data" link', () => {
      render(<ResetDiscrubButton variant="link" />);
      expect(screen.getByTestId('reset-discrub-link')).toBeInTheDocument();
      expect(screen.getByText(/Stuck\? Reset data/)).toBeInTheDocument();
    });

    it('opens the confirmation modal when clicked', () => {
      render(<ResetDiscrubButton variant="link" />);
      fireEvent.click(screen.getByTestId('reset-discrub-link'));
      expect(screen.getByText('Reset all Discrub data?')).toBeInTheDocument();
    });
  });

  describe('button variant (Settings)', () => {
    it('renders the "Reset data" button', () => {
      render(<ResetDiscrubButton variant="button" />);
      expect(screen.getByTestId('reset-discrub-button')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset data' })).toBeInTheDocument();
    });

    it('defaults to button variant when no variant prop is passed', () => {
      render(<ResetDiscrubButton />);
      expect(screen.getByTestId('reset-discrub-button')).toBeInTheDocument();
    });

    it('opens the confirmation modal when clicked', () => {
      render(<ResetDiscrubButton variant="button" />);
      fireEvent.click(screen.getByTestId('reset-discrub-button'));
      expect(screen.getByText('Reset all Discrub data?')).toBeInTheDocument();
    });
  });

  describe('confirmation modal', () => {
    beforeEach(() => {
      render(<ResetDiscrubButton variant="button" />);
      fireEvent.click(screen.getByTestId('reset-discrub-button'));
    });

    it('lists the categories of data that will be cleared', () => {
      expect(screen.getByText(/Settings and preferences/)).toBeInTheDocument();
      expect(screen.getByText(/Export presets and recent exports/)).toBeInTheDocument();
      expect(screen.getByText(/Cached user info and status log/)).toBeInTheDocument();
      expect(screen.getByText(/Imported data packages and downloaded media/)).toBeInTheDocument();
    });

    it('says this only affects this device and that Discrub signs in again from the open tab (row 115)', () => {
      expect(
        screen.getByText(/signs in again from the open Discord tab/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/this device only/),
      ).toBeInTheDocument();
      expect(screen.getByText('Workspaces and their saved messages')).toBeInTheDocument();
    });

    it('Cancel closes the modal without calling resetDiscrubData', async () => {
      fireEvent.click(screen.getByTestId('reset-discrub-cancel'));
      await waitFor(() =>
        expect(screen.queryByText('Reset all Discrub data?')).not.toBeInTheDocument(),
      );
      expect(mockReset).not.toHaveBeenCalled();
    });

    it('Reset everything calls resetDiscrubData', async () => {
      fireEvent.click(screen.getByTestId('reset-discrub-confirm'));
      await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(1));
    });

    it('shows loading state while reset is in flight', async () => {
      let resolveReset: () => void;
      mockReset.mockImplementation(
        () => new Promise<void>((r) => { resolveReset = r; }),
      );

      fireEvent.click(screen.getByTestId('reset-discrub-confirm'));

      await waitFor(() => {
        expect(screen.getByText('Resetting…')).toBeInTheDocument();
      });
      expect(screen.getByTestId('reset-discrub-cancel')).toBeDisabled();
      expect(screen.getByTestId('reset-discrub-confirm')).toBeDisabled();

      resolveReset!();
    });

    it('forces a reload if resetDiscrubData throws (escape hatch must always recover)', async () => {
      mockReset.mockRejectedValueOnce(new Error('boom'));

      fireEvent.click(screen.getByTestId('reset-discrub-confirm'));

      await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    });
  });
});
