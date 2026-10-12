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
import { useLoadAllLabel } from './useLoadAllLabel';
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
