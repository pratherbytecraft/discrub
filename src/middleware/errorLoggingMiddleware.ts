import type { Middleware } from '@reduxjs/toolkit';
import { addStatusEntry } from '@features/status/statusSlice';

/**
 * Thunk action types that should NOT be logged as errors when rejected.
 * These are expected failures or silently handled cases.
 */
const SUPPRESSED_THUNKS = [
  'message/enrichMessageUsers', // Enrichment failures don't block message display
];

/**
 * Redux middleware that intercepts rejected async thunks and logs them
 * as error entries in the status log. Provides automatic error visibility
 * without requiring manual dispatch in every thunk's catch block.
 */
export const errorLoggingMiddleware: Middleware = (storeAPI) => (next) => (action: any) => {
  const result = next(action);

  // Only intercept rejected thunk actions
  if (action?.type?.endsWith('/rejected') && action?.error) {
    const thunkName = action.type.replace('/rejected', '');

    // Skip suppressed thunks
    if (SUPPRESSED_THUNKS.includes(thunkName)) {
      return result;
    }

    // Extract error message — prefer payload (from rejectWithValue) over error.message
    const errorMessage =
      (typeof action.payload === 'string' && action.payload) ||
      action.error?.message ||
      'Unknown error';

    // Skip generic "Rejected" or "Aborted" messages (user-initiated cancellations)
    if (errorMessage === 'Rejected' || errorMessage === 'Aborted' || errorMessage.includes('cancelled')) {
      return result;
    }

    // The log is read by users, so it carries the message alone (rows 28
    // and 49); the thunk's name goes to the console for debugging.
    console.debug(`[Discrub] ${thunkName} rejected`);
    storeAPI.dispatch(
      addStatusEntry({
        level: 'error',
        message: errorMessage,
      })
    );
  }

  return result;
};
