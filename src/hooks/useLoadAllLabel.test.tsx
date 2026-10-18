/**
 * 2.2.5 group E (rows 5, 13, 27): a run records itself when it starts, so
 * the labels read Resume only when that record is there and nothing runs.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { createAuthenticatedState } from '@/test/state-factories';
import { initialWorkspaceState, type UnfinishedBulk } from '@features/workspace/workspaceSlice';
import { LEGACY_DEFAULT_WORKSPACE_ID } from '@features/workspace/workspaceTypes';
import { useLoadAllAvailable, useLoadAllLabel } from './useLoadAllLabel';
import { useResumeLabels } from './useResume';

const base = createAuthenticatedState();
const CID = base.channel.selectedChannel!.id;
const GUILD_ID = base.guild.selectedGuild!.id;

function stateWith({ loadAll = false, running = false, bulk = null }: { loadAll?: boolean; running?: boolean; bulk?: UnfinishedBulk | null }) {
  return {
    ...base,
    message: { ...base.message, pagination: { ...base.message.pagination, hasMore: true, isLoadingAll: running } },
    workspace: {
      ...initialWorkspaceState,
      currentWid: LEGACY_DEFAULT_WORKSPACE_ID,
      ready: true,
      actions: loadAll ? { [CID]: { cid: CID, name: 'general', kind: 'loadAll' as const } } : {},
      bulk,
    },
  };
}

function Labels() {
  const loadAll = useLoadAllLabel();
  const { purgeLabel, purgeResumable } = useResumeLabels('channels');
  return <div data-testid="labels">{`${loadAll}|${purgeLabel}|${purgeResumable}`}</div>;
}

const PURGE: UnfinishedBulk = { kind: 'bulkPurge', mode: 'channels', guildId: GUILD_ID } as UnfinishedBulk;

describe('Resume labels', () => {
  it('read Load All and Purge with nothing recorded', () => {
    renderWithProviders(<Labels />, { preloadedState: stateWith({}) });
    expect(screen.getByTestId('labels').textContent).toBe('Load All|Purge|false');
  });

  it('read Resume for a recorded run while nothing runs', () => {
    renderWithProviders(<Labels />, { preloadedState: stateWith({ loadAll: true, bulk: PURGE }) });
    expect(screen.getByTestId('labels').textContent).toBe('Resume|Resume|true');
  });

  it('keep their plain names while the run that wrote the record is going', () => {
    renderWithProviders(<Labels />, { preloadedState: stateWith({ loadAll: true, bulk: PURGE, running: true }) });
    expect(screen.getByTestId('labels').textContent).toBe('Load All|Purge|false');
  });
});

// 2.2.5 B: every layout's Load All button reads this.
function Available() {
  const available = useLoadAllAvailable();
  return <div data-testid="available">{String(available)}</div>;
}

function availabilityState(overrides: { hasMore?: boolean; isLoadingAll?: boolean; restored?: boolean; saved?: number; mode?: 'paginated' | 'search' }) {
  const s = stateWith({});
  return {
    ...s,
    message: {
      ...s.message,
      restored: overrides.restored ? { count: 5, oldestTimestamp: null } : null,
      pagination: { ...s.message.pagination, hasMore: overrides.hasMore ?? false, isLoadingAll: overrides.isLoadingAll ?? false, mode: overrides.mode ?? 'paginated' },
    },
    workspace: {
      ...s.workspace,
      list: overrides.saved
        ? [{ wid: LEGACY_DEFAULT_WORKSPACE_ID, name: 'Default', color: '', bytes: 1, count: overrides.saved, conversationCount: 1, lastOpened: 0, openable: true, appVersion: '2.2.5', heldElsewhere: false, isDefault: true, work: null, conversations: [{ cid: CID, kind: 'channel' as const, name: 'general', guildName: null, parentName: null, count: overrides.saved, bytes: 1 }] }]
        : [],
    },
  };
}

describe('useLoadAllAvailable (2.2.5 B)', () => {
  it('is false with nothing more to load, nothing restored and nothing saved', () => {
    renderWithProviders(<Available />, { preloadedState: availabilityState({}) });
    expect(screen.getByTestId('available').textContent).toBe('false');
  });

  it('is true while more pages exist or a Load All runs', () => {
    renderWithProviders(<Available />, { preloadedState: availabilityState({ hasMore: true }) });
    expect(screen.getByTestId('available').textContent).toBe('true');
    renderWithProviders(<Available />, { preloadedState: availabilityState({ isLoadingAll: true }) });
    expect(screen.getAllByTestId('available')[1].textContent).toBe('true');
  });

  it('stays true for a complete conversation the workspace restored or holds, so Start over is reachable', () => {
    renderWithProviders(<Available />, { preloadedState: availabilityState({ restored: true }) });
    expect(screen.getByTestId('available').textContent).toBe('true');
    renderWithProviders(<Available />, { preloadedState: availabilityState({ saved: 200 }) });
    expect(screen.getAllByTestId('available')[1].textContent).toBe('true');
  });

  it('does not count a saved conversation while a search is showing', () => {
    renderWithProviders(<Available />, { preloadedState: availabilityState({ saved: 200, mode: 'search' }) });
    expect(screen.getByTestId('available').textContent).toBe('false');
  });
});
