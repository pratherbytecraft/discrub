import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFastScroll, FAST_SCROLL_REST_MS, FAST_SCROLL_SETTLE_MS } from './useFastScroll';

// Scroll events carry no velocity of their own: the hook reads scrollTop and
// performance.now between events, so each test moves both by hand.
describe('useFastScroll', () => {
  let el: HTMLDivElement;
  let now = 0;

  const scrollTo = (top: number, afterMs: number) => {
    now += afterMs;
    el.scrollTop = top;
    el.dispatchEvent(new Event('scroll'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true });
    document.body.appendChild(el);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    el.remove();
  });

  // The component passes a stable useRef; a fresh object each render would re-run the effect.
  const render = () => { const ref = { current: el }; return renderHook(() => useFastScroll(ref)); };

  it('starts idle', () => {
    const { result } = render();
    expect(result.current).toMatchObject({ fast: false, settling: false });
    expect(result.current.velocityRef.current).toBe(0);
  });

  it('keeps the signed velocity of the last event in a ref', () => {
    const { result } = render();
    act(() => scrollTo(640, 16));
    expect(result.current.velocityRef.current).toBe(40);
    act(() => scrollTo(0, 16));
    expect(result.current.velocityRef.current).toBe(-40);
  });

  it('ignores a single jump, such as a scroll anchor restore or a deep link', () => {
    const { result } = render();
    act(() => scrollTo(50000, 16));
    expect(result.current.fast).toBe(false);
  });

  it('ignores wheel scrolling under the threshold', () => {
    const { result } = render();
    act(() => { scrollTo(30, 16); scrollTo(60, 16); scrollTo(90, 16); });
    expect(result.current.fast).toBe(false);
  });

  it('enters fast on two consecutive fast events, then settles after the rest and the fade', () => {
    const { result } = render();
    act(() => scrollTo(600, 16));
    expect(result.current.fast).toBe(false);
    act(() => scrollTo(1200, 16));
    expect(result.current).toMatchObject({ fast: true, settling: false });
    act(() => scrollTo(1800, 16));
    expect(result.current.fast).toBe(true);
    act(() => { vi.advanceTimersByTime(FAST_SCROLL_REST_MS + 1); });
    expect(result.current).toMatchObject({ fast: false, settling: true });
    act(() => { vi.advanceTimersByTime(FAST_SCROLL_SETTLE_MS + 1); });
    expect(result.current).toMatchObject({ fast: false, settling: false });
  });

  it('a fast event after a gap of a second or more does not count towards entering', () => {
    const { result } = render();
    act(() => scrollTo(600, 16));
    act(() => scrollTo(50000, 1200));
    expect(result.current.fast).toBe(false);
  });

  it('counts events the browser coalesced while the rows rendered', () => {
    const { result } = render();
    act(() => scrollTo(6000, 250));
    act(() => scrollTo(12000, 300));
    expect(result.current.fast).toBe(true);
  });

  it('keeps fast alive while events keep coming and leaves only once they stop', () => {
    const { result } = render();
    act(() => { scrollTo(600, 16); scrollTo(1200, 16); });
    for (let i = 0; i < 10; i++) {
      act(() => { vi.advanceTimersByTime(100); scrollTo(1200 + (i + 1) * 600, 100); });
      expect(result.current.fast).toBe(true);
    }
    act(() => { vi.advanceTimersByTime(FAST_SCROLL_REST_MS + 1); });
    expect(result.current.settling).toBe(true);
  });

  it('a new fast scroll during the settle beat goes straight back to fast', () => {
    const { result } = render();
    act(() => { scrollTo(600, 16); scrollTo(1200, 16); });
    act(() => { vi.advanceTimersByTime(FAST_SCROLL_REST_MS + 1); });
    expect(result.current.settling).toBe(true);
    act(() => { scrollTo(1800, 16); scrollTo(2400, 16); });
    expect(result.current).toMatchObject({ fast: true, settling: false });
    // The old settle timer was cleared: still fast short of the next rest.
    act(() => { vi.advanceTimersByTime(FAST_SCROLL_REST_MS - 1); });
    expect(result.current).toMatchObject({ fast: true, settling: false });
  });

  it('removes its listener and timers on unmount', () => {
    const { result, unmount } = render();
    act(() => { scrollTo(600, 16); scrollTo(1200, 16); });
    expect(result.current.fast).toBe(true);
    unmount();
    expect(() => { vi.advanceTimersByTime(1000); scrollTo(5000, 16); }).not.toThrow();
  });
});
