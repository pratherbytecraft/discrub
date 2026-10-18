import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageChunkSkeleton, { skeletonLines, skeletonBlockHeight } from './MessageChunkSkeleton';

describe('skeletonLines', () => {
  it('gives two lines when the height is unknown', () => {
    expect(skeletonLines(undefined)).toBe(2);
  });
  it('scales with the chunk height between one and four lines', () => {
    expect(skeletonLines(40)).toBe(1);
    expect(skeletonLines(68)).toBe(2);
    expect(skeletonLines(112)).toBe(4);
    expect(skeletonLines(600)).toBe(4);
  });
});

describe('skeletonBlockHeight', () => {
  it('is zero for a chunk the bars already fill', () => {
    expect(skeletonBlockHeight(undefined)).toBe(0);
    expect(skeletonBlockHeight(68)).toBe(0);
    expect(skeletonBlockHeight(112)).toBe(0);
  });
  it('fills the rest of a tall chunk, capped', () => {
    expect(skeletonBlockHeight(300)).toBe(300 - 24 - 88 - 12);
    expect(skeletonBlockHeight(900)).toBe(320);
  });
});

describe('<MessageChunkSkeleton />', () => {
  it('draws an avatar, a name bar and the text bars for its height', () => {
    const { container } = render(<MessageChunkSkeleton height={112} />);
    const root = screen.getByTestId('message-chunk-skeleton');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.avatar')).toHaveLength(1);
    // One name bar plus four text bars.
    expect(container.querySelectorAll('.bar')).toHaveLength(5);
  });

  it('draws a media block under the bars of a tall chunk', () => {
    const { container } = render(<MessageChunkSkeleton height={320} />);
    expect(container.querySelector('.block')).toHaveStyle({ height: `${320 - 24 - 88 - 12}px` });
    const { container: short } = render(<MessageChunkSkeleton height={68} />);
    expect(short.querySelector('.block')).toBeNull();
  });

  it('sizes itself to the chunk height it stands in for', () => {
    render(<MessageChunkSkeleton height={90} />);
    expect(screen.getByTestId('message-chunk-skeleton')).toHaveStyle({ height: '90px' });
  });

  it('as a pending chunk it keeps the minimum height and its own test id', () => {
    render(<MessageChunkSkeleton data-testid="message-chunk-pending" />);
    expect(screen.getByTestId('message-chunk-pending')).toHaveStyle({ minHeight: '56px' });
  });

  it('as an overlay it sits over the row and lets clicks through', () => {
    render(<MessageChunkSkeleton height={60} overlay fade="out" data-testid="message-chunk-skeleton-fading" />);
    expect(screen.getByTestId('message-chunk-skeleton-fading')).toHaveStyle({ position: 'absolute', pointerEvents: 'none' });
  });

  it('a row of the fast layer carries no animation of its own', () => {
    render(<MessageChunkSkeleton height={60} animated={false} />);
    expect(screen.getByTestId('message-chunk-skeleton')).toHaveStyle({ animation: 'none' });
  });

  it('varies the bar widths with the seed so a column does not repeat', () => {
    const { container: a } = render(<MessageChunkSkeleton height={68} seed={0} />);
    const { container: b } = render(<MessageChunkSkeleton height={68} seed={1} />);
    const widths = (c: HTMLElement) => [...c.querySelectorAll('.bar:not(.name)')].map((e) => (e as HTMLElement).style.width);
    expect(widths(a)).not.toEqual(widths(b));
  });
});
