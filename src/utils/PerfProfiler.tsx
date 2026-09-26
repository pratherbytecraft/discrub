import { Profiler, type ReactNode } from 'react';

/**
 * React Profiler wrapper for the perf build only (`VITE_PERF_HOOKS=true`).
 * Adds the subtree's actual render time to `window.__perfTimes__[id]` so
 * `tooling/perf/render-count.cjs` can say where a phase's render time went.
 * In every other build it renders its children and nothing else.
 */
const onRender = (id: string, _phase: string, actualDuration: number) => {
  const w = window as unknown as { __perfTimes__?: Record<string, { ms: number; n: number }> };
  const times = (w.__perfTimes__ ??= {});
  const cur = (times[id] ??= { ms: 0, n: 0 });
  cur.ms += actualDuration;
  cur.n += 1;
};

export const PerfProfiler = ({ id, children }: { id: string; children: ReactNode }) =>
  import.meta.env.VITE_PERF_HOOKS === 'true' ? <Profiler id={id} onRender={onRender}>{children}</Profiler> : <>{children}</>;
