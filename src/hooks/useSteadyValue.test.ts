import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSteadyValue } from './useSteadyValue';

describe('useSteadyValue', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the first value, holds fast changes, and lands the last one', () => {
    const { result, rerender } = renderHook(({ v, k }) => useSteadyValue(v, k, 500), { initialProps: { v: 1, k: 'running' } });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ v: 2, k: 'running' });
    rerender({ v: 3, k: 'running' });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe(3);
  });

  it('lets a change through at once when enough time has passed', () => {
    const { result, rerender } = renderHook(({ v, k }) => useSteadyValue(v, k, 500), { initialProps: { v: 1, k: 'running' } });
    act(() => { vi.advanceTimersByTime(600); });
    rerender({ v: 2, k: 'running' });
    expect(result.current).toBe(2);
  });

  it('lets a change of key through at once', () => {
    const { result, rerender } = renderHook(({ v, k }) => useSteadyValue(v, k, 500), { initialProps: { v: 1, k: 'running' } });
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ v: 2, k: 'paused' });
    expect(result.current).toBe(2);
  });
});
