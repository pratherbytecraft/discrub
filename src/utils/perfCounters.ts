/**
 * Render and call counters for the perf build only (`VITE_PERF_HOOKS=true`).
 * The flag is inlined at build time, so the shipped bundles carry nothing.
 * `tooling/perf/render-count.cjs` reads `window.__perfCounts__` around each
 * phase to say which components rendered how many times.
 */
export const perfCount = (name: string): void => {
  if (import.meta.env.VITE_PERF_HOOKS === 'true') {
    const w = window as unknown as { __perfCounts__?: Record<string, number> };
    const counts = (w.__perfCounts__ ??= {});
    counts[name] = (counts[name] ?? 0) + 1;
  }
};
