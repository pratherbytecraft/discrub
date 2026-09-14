import { describe, it, expect, vi } from 'vitest';
import { previewGuardMiddleware, previewSafe, isPreviewingState } from './previewGuardMiddleware';

const run = (previewing: boolean, action: unknown) => {
  const next = vi.fn((a) => a);
  const api = { getState: () => ({ app: { preview: previewing ? { layout: 'workbench', theme: null } : { layout: null, theme: null } } }), dispatch: vi.fn() };
  const result = previewGuardMiddleware(api)(next)(action);
  return { next, result };
};

describe('previewGuardMiddleware', () => {
  it('lets plain actions through during a preview', () => {
    const { next } = run(true, { type: 'app/endPreview' });
    expect(next).toHaveBeenCalledWith({ type: 'app/endPreview' });
  });

  it('lets thunks through when nothing is previewed', () => {
    const thunk = vi.fn();
    const { next } = run(false, thunk);
    expect(next).toHaveBeenCalledWith(thunk);
  });

  it('drops an unmarked thunk during a preview and the result is awaitable with a rejecting unwrap', async () => {
    const thunk = vi.fn();
    const { next, result } = run(true, thunk);
    expect(next).not.toHaveBeenCalled();
    expect(thunk).not.toHaveBeenCalled();
    const r = result as { unwrap: () => Promise<unknown> } & Promise<{ type: string }>;
    await expect(r).resolves.toEqual({ type: 'app/previewBlocked' });
    await expect(r.unwrap()).rejects.toMatchObject({ name: 'PreviewBlocked' });
  });

  it('lets a previewSafe thunk through during a preview and keeps the creator statics', () => {
    const base = Object.assign((n: number) => Object.assign(() => n, {}), { typePrefix: 'x/y', pending: 'x/y/pending' });
    const safe = previewSafe(base);
    expect(safe.typePrefix).toBe('x/y');
    const thunk = safe(1);
    const { next } = run(true, thunk);
    expect(next).toHaveBeenCalledWith(thunk);
  });

  it('isPreviewingState reads either half of the preview', () => {
    expect(isPreviewingState({ app: { preview: { layout: null, theme: 'terminal' } } })).toBe(true);
    expect(isPreviewingState({ app: { preview: { layout: null, theme: null } } })).toBe(false);
    expect(isPreviewingState({ app: {} })).toBe(false);
    expect(isPreviewingState(undefined)).toBe(false);
  });
});
