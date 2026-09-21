import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import FollowStamp, { makeCracks } from './FollowStamp';
import { DEVELOPER } from '@components/welcome/developer';

describe('FollowStamp', () => {
  it('links to the developer on GitHub in a new tab', () => {
    renderWithProviders(<FollowStamp />);
    const stamp = screen.getByTestId('follow-stamp');
    expect(stamp).toHaveAttribute('href', DEVELOPER.profileUrl);
    expect(stamp).toHaveAttribute('target', '_blank');
    expect(stamp).toHaveTextContent(`Follow @${DEVELOPER.handle}`);
  });

  it('shows the link straight away when the effect cannot run (no dialog, no canvas)', () => {
    renderWithProviders(<FollowStamp />);
    expect(screen.getByTestId('follow-stamp')).toHaveAttribute('data-phase', 'landed');
    expect(screen.getByTestId('follow-stamp')).toBeVisible();
  });

  it('keeps the canvas out of the way of clicks and assistive tech', () => {
    renderWithProviders(<FollowStamp />);
    const canvas = screen.getByTestId('follow-stamp-canvas');
    expect(canvas).toHaveAttribute('aria-hidden');
    expect(canvas).toHaveStyle({ pointerEvents: 'none' });
  });

  it('draws the same cracks every time, all starting at the stamp', () => {
    const seeded = () => { let s = 7; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
    const a = makeCracks(128, 985, 104, seeded());
    const b = makeCracks(128, 985, 104, seeded());
    expect(a).toEqual(b);
    expect(a).toHaveLength(13);
    for (const crack of a) expect(Math.abs(crack.pts[0][0] - 128)).toBeLessThanOrEqual(125);
  });
});
