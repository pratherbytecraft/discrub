import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';

/**
 * Fast scroll detection for the virtualized feed (2.2.5, scroll skeletons).
 *
 * A scrollbar drag or a hard fling moves the viewport faster than the rows
 * can render, and the feed shows empty space until the scroll stops. While
 * the scroller moves faster than `threshold` pixels per millisecond the feed
 * draws skeleton rows instead of chunks; once it rests for `restMs` the real
 * rows come back under a short cross-fade (`settleMs`).
 *
 * Two consecutive fast scroll events are needed to enter, so a single
 * programmatic jump (scroll anchor restore, deep link, a channel switch)
 * never shows a skeleton. Wheel scrolling stays well under the threshold.
 */
export interface FastScrollOptions {
  /** Pixels per millisecond that count as fast. */
  threshold?: number;
  /** Quiet time after the last scroll event before the real rows return. */
  restMs?: number;
  /** How long the cross-fade from skeleton to row lasts. */
  settleMs?: number;
}

export interface FastScrollState {
  /** True while the scroller is moving fast; the feed renders skeletons. */
  fast: boolean;
  /** True for `settleMs` after a fast scroll ends; the feed fades its rows in over fading skeletons. */
  settling: boolean;
  /** Signed pixels per millisecond of the last scroll event, read without a render. */
  velocityRef: MutableRefObject<number>;
}

export const FAST_SCROLL_THRESHOLD = 2.5;
export const FAST_SCROLL_REST_MS = 140;
export const FAST_SCROLL_SETTLE_MS = 260;

const IDLE = { fast: false, settling: false };

export function useFastScroll(ref: RefObject<HTMLElement | null>, options: FastScrollOptions = {}): FastScrollState {
  const { threshold = FAST_SCROLL_THRESHOLD, restMs = FAST_SCROLL_REST_MS, settleMs = FAST_SCROLL_SETTLE_MS } = options;
  const [state, setState] = useState<Omit<FastScrollState, 'velocityRef'>>(IDLE);
  const velocityRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    let lastTime = performance.now();
    let fastEvents = 0;
    let fast = false;
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const leave = () => {
      fast = false;
      fastEvents = 0;
      setState({ fast: false, settling: true });
      settleTimer = setTimeout(() => setState(IDLE), settleMs);
    };

    const onScroll = () => {
      const now = performance.now();
      const top = el.scrollTop;
      const dt = now - lastTime;
      const velocity = Math.abs(top - lastTop) / Math.max(1, dt);
      velocityRef.current = (top - lastTop) / Math.max(1, dt);
      lastTop = top;
      lastTime = now;
      // While the rows render, the browser coalesces scroll events and a
      // long gap between two of them is the busy case this exists for; only
      // a gap of a second or more means the previous event is stale.
      const isFast = velocity > threshold && dt < 1000;
      fastEvents = isFast ? fastEvents + 1 : 0;
      if (!fast && fastEvents >= 2) {
        fast = true;
        clearTimeout(settleTimer);
        setState({ fast: true, settling: false });
      }
      if (fast) {
        clearTimeout(restTimer);
        restTimer = setTimeout(leave, restMs);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(restTimer);
      clearTimeout(settleTimer);
    };
  }, [ref, threshold, restMs, settleMs]);

  return { ...state, velocityRef };
}
