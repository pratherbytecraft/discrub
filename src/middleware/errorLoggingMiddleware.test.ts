import { describe, it, expect, vi } from 'vitest';
import { errorLoggingMiddleware } from './errorLoggingMiddleware';
import { addStatusEntry } from '@features/status/statusSlice';

describe('errorLoggingMiddleware', () => {
  const createMockStore = () => ({
    dispatch: vi.fn(),
    getState: vi.fn(),
  });

  const next = vi.fn((action: any) => action);

  it('passes non-rejected actions through without logging', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({ type: 'message/fetchMessages/fulfilled', payload: [] });

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('logs rejected thunk actions as error status entries', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'message/fetchMessages/rejected',
      error: { message: 'Network error' },
    });

    expect(store.dispatch).toHaveBeenCalledWith(
      addStatusEntry({
        level: 'error',
        message: 'Network error',
      })
    );
  });

  it('prefers rejectWithValue payload over error.message', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'guild/fetchGuilds/rejected',
      payload: 'Failed to fetch guilds',
      error: { message: 'Rejected' },
    });

    expect(store.dispatch).toHaveBeenCalledWith(
      addStatusEntry({
        level: 'error',
        message: 'Failed to fetch guilds',
      })
    );
  });

  it('logs a translation key payload as its text', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'supporter/applyPastedKey/rejected',
      payload: 'supporter.error.accessEnded',
      error: { message: 'Rejected' },
    });

    expect(store.dispatch).toHaveBeenCalledWith(
      addStatusEntry({
        level: 'error',
        message: 'Your supporter access has ended. After renewing, click Refresh or paste the new key.',
      })
    );
  });

  it('suppresses enrichMessageUsers rejections', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'message/enrichMessageUsers/rejected',
      error: { message: 'Failed to enrich' },
    });

    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('suppresses generic "Rejected" messages (user cancellations)', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'message/searchMessages/rejected',
      error: { message: 'Rejected' },
    });

    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('suppresses "Aborted" messages', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'message/searchMessages/rejected',
      error: { message: 'Aborted' },
    });

    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('suppresses messages containing "cancelled"', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'export/exportMessages/rejected',
      payload: 'Search cancelled',
      error: { message: 'Rejected' },
    });

    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('falls back to "Unknown error" when no message available', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({
      type: 'dm/fetchDms/rejected',
      error: {},
    });

    expect(store.dispatch).toHaveBeenCalledWith(
      addStatusEntry({
        level: 'error',
        message: 'Unknown error',
      })
    );
  });

  it('ignores actions without error property', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    middleware({ type: 'some/action/rejected' });

    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('always calls next to continue the middleware chain', () => {
    const store = createMockStore();
    const middleware = errorLoggingMiddleware(store)(next);

    const action = {
      type: 'message/fetchMessages/rejected',
      error: { message: 'Test' },
    };
    const result = middleware(action);

    expect(next).toHaveBeenCalledWith(action);
    expect(result).toBe(action);
  });
});
