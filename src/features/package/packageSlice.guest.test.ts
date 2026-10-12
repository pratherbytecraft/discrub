import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureStore,
  type ThunkDispatch,
  type UnknownAction,
} from '@reduxjs/toolkit';
import packageReducer, { resumeStoredPackage, revalidatePackage } from './packageSlice';
import authReducer, { enterGuestMode } from '@features/auth/authSlice';
import userReducer from '@features/user/userSlice';
import type { RootState } from '@/app/store';
import {
  PACKAGE_CHANNEL_TYPE,
  type ParsedPackage,
} from './packageTypes';

const mockResume = vi.fn();
const mockFindOwner = vi.fn();
vi.mock('@/services/packageStreamService', async () => {
  const actual = await vi.importActual<any>('@/services/packageStreamService');
  return {
    ...actual,
    resumePackageFromStorage: (...args: unknown[]) => mockResume(...args),
    findStoredPackageOwner: () => mockFindOwner(),
  };
});

const parsed: ParsedPackage = {
  user: { id: 'owner-1', username: 'owner', globalName: 'Owner', avatarHash: null },
  guilds: [],
  channels: [
    { id: '200', type: PACKAGE_CHANNEL_TYPE.GUILD_TEXT, name: 'general', guildId: 'g1', guildName: 'Guild A', messageCount: 5, isOrphan: false },
  ],
  totalMessages: 5,
  packageSizeBytes: 1,
};

function makeStore() {
  return configureStore({
    reducer: { package: packageReducer, auth: authReducer, user: userReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  }) as unknown as {
    dispatch: ThunkDispatch<RootState, unknown, UnknownAction>;
    getState: () => RootState;
  };
}

// #275: a guest resumes the stored package by its own owner id and gets
// it read-only; signing in afterwards validates it against the account.
describe('packageSlice guest browsing (#275)', () => {
  beforeEach(() => {
    mockResume.mockReset();
    mockFindOwner.mockReset();
  });

  it('does nothing without a user when not a guest', async () => {
    const store = makeStore();
    const action = await store.dispatch(resumeStoredPackage());
    expect(action.payload).toBeNull();
    expect(mockFindOwner).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  it('resumes the stored package read-only for a guest', async () => {
    const store = makeStore();
    store.dispatch(enterGuestMode());
    mockFindOwner.mockResolvedValue('owner-1');
    mockResume.mockResolvedValue(parsed);

    const action = await store.dispatch(resumeStoredPackage());
    expect(action.type).toBe('package/resume/fulfilled');
    expect(mockResume).toHaveBeenCalledWith('owner-1');
    const state = store.getState().package;
    expect(state.parsed?.user.id).toBe('owner-1');
    expect(state.validation?.ok).toBe(true);
    expect(state.validation?.readOnly).toBe(true);
    expect(state.validation?.warnings[0]).toMatch(/Not signed in/);
  });

  it('stays empty for a guest when nothing is stored', async () => {
    const store = makeStore();
    store.dispatch(enterGuestMode());
    mockFindOwner.mockResolvedValue(null);
    const action = await store.dispatch(resumeStoredPackage());
    expect(action.payload).toBeNull();
    expect(mockResume).not.toHaveBeenCalled();
  });

  it('revalidate turns read-only off once the package owner signs in', async () => {
    const store = makeStore();
    store.dispatch(enterGuestMode());
    mockFindOwner.mockResolvedValue('owner-1');
    mockResume.mockResolvedValue(parsed);
    await store.dispatch(resumeStoredPackage());
    expect(store.getState().package.validation?.readOnly).toBe(true);

    store.dispatch({ type: 'user/setCurrentUser', payload: { id: 'owner-1', username: 'owner' } });
    await store.dispatch(revalidatePackage());
    expect(store.getState().package.validation?.readOnly).toBe(false);
    expect(store.getState().package.validation?.warnings).toHaveLength(0);
  });

  it('revalidate keeps another user read-only with the mismatch notice', async () => {
    const store = makeStore();
    store.dispatch(enterGuestMode());
    mockFindOwner.mockResolvedValue('owner-1');
    mockResume.mockResolvedValue(parsed);
    await store.dispatch(resumeStoredPackage());

    store.dispatch({ type: 'user/setCurrentUser', payload: { id: 'someone-else', username: 'else' } });
    await store.dispatch(revalidatePackage());
    expect(store.getState().package.validation?.readOnly).toBe(true);
    expect(store.getState().package.validation?.warnings[0]).toMatch(/different user/);
  });
});
