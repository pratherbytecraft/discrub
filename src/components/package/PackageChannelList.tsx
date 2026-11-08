import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItemButton,
  ListSubheader,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Archive as ArchiveIcon,
  AlternateEmail as DmIcon,
  CheckBox as SelectModeIcon,
  CheckBoxOutlineBlank as SelectModeOffIcon,
  ExpandLess,
  ExpandMore,
  Forum as ThreadIcon,
  GroupAdd as GroupDmIcon,
  Tag as TextChannelIcon,
  VisibilityOff as HideIcon,
  Visibility as ShowIcon,
  HelpOutline as UnknownChannelIcon,
  Refresh,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  clearBulkChannelSelection,
  dismissBulkDelete,
  recheckLeftServers,
  requestBulkSkip,
  selectBulkDelete,
  selectBulkSelectedChannelIds,
  selectChannelDeletedMessageCount,
  selectChannelGoneMessageCount,
  selectIsPackageReadOnly,
  selectLeftServersRecheckStatus,
  selectPackageChannel,
  selectParsedPackage,
  selectSelectedPackageChannelId,
  setBulkChannelSelection,
  toggleBulkChannelSelection,
  type BulkDeleteChannelState,
} from '@features/package/packageSlice';
import MultiSelectControls from '@components/navigation/MultiSelectControls';
import BulkPackageDeleteDialog from './BulkPackageDeleteDialog';
import { formatProvenanceTooltip } from '@features/package/packageStatusCopy';
import type { PackageChannel } from '@features/package/packageTypes';
import {
  getPackageChannelCategory,
  getPackageChannelLabel,
  getPackageChannelSubtitle,
  type PackageChannelCategory,
} from '@features/package/packageDisplayUtils';
import { SaveFailedListLink } from '@components/failures/LastRunFailures';
import { selectFailureCount } from '@features/failures/failuresSlice';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { nameIncludes } from '@utils/nameMatch';

interface PackageChannelListProps {
  filterText?: string;
}

/**
 * Sidebar channel browser for a loaded data package.
 *
 * Channels are grouped by category (servers / DMs / left servers) so the
 * user can scan "what's in here" at a glance. Since 2.2.9 the Servers
 * section holds one collapsible group per Server, its text channels first
 * and its threads after them, and in Multi-select each Server header has a
 * checkbox for everything under it (GitHub issue 23). Within each group
 * entries are sorted by message count descending. A type icon sits next
 * to each row so the kind of channel (text, DM, thread, orphan) is
 * identifiable without reading the subtitle.
 *
 * Empty channels (messageCount === 0) are hidden by default — Discord
 * packages commonly contain hundreds of historical metadata-only
 * channel stubs that add noise without signal.
 */
const PackageChannelList = ({ filterText = '' }: PackageChannelListProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const parsed = useAppSelector(selectParsedPackage);
  const selectedId = useAppSelector(selectSelectedPackageChannelId);
  const token = useAppSelector((s) => s.auth.token);
  const recheckStatus = useAppSelector(selectLeftServersRecheckStatus);
  const readOnly = useAppSelector(selectIsPackageReadOnly);
  const bulkSelected = useAppSelector(selectBulkSelectedChannelIds);
  const bulk = useAppSelector(selectBulkDelete);
  // A layout switch remounts the sidebar; ticks kept in the store mean Multi-select was on.
  const [multiSelectMode, setMultiSelectMode] = useState(() => bulkSelected.length > 0);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<PackageChannelCategory, boolean>>({
    guildText: false,
    thread: false,
    dm: false,
    groupDm: false,
    orphan: true, // collapsed by default — less noise
    unknown: false,
  });
  // 2.2.9: fold state per Server, keyed like the groups. Every Server starts open.
  const [collapsedServers, setCollapsedServers] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!parsed) return [];
    const q = filterText.trim();
    return parsed.channels.filter((c) => {
      if (!showEmpty && c.messageCount === 0) return false;
      if (!q) return true;
      // #274: NFKC fold so fancy font names match plain typing.
      return nameIncludes(getPackageChannelLabel(c), q) || nameIncludes(c.guildName, q);
    });
  }, [parsed, filterText, showEmpty]);

  const emptyCount = useMemo(
    () => (parsed ? parsed.channels.filter((c) => c.messageCount === 0).length : 0),
    [parsed],
  );

  const grouped = useMemo(() => {
    const map: Record<PackageChannelCategory, PackageChannel[]> = {
      guildText: [],
      thread: [],
      dm: [],
      groupDm: [],
      orphan: [],
      unknown: [],
    };
    // 2.2.9: Server channels and the threads that name a Server go into one
    // group per Server. A thread with no Server on record keeps the Threads section.
    const servers = new Map<string, ServerGroup>();
    for (const c of filtered) {
      const category = getPackageChannelCategory(c);
      const key = serverKeyOf(c);
      if ((category === 'guildText' || category === 'thread') && key) {
        const group = servers.get(key) ?? { key, name: c.guildName || c.guildId || '', channels: [], messageCount: 0 };
        group.channels.push(c);
        group.messageCount += c.messageCount;
        servers.set(key, group);
      } else {
        map[category].push(c);
      }
    }
    // Sort each bucket by message count desc.
    (Object.keys(map) as PackageChannelCategory[]).forEach((k) =>
      map[k].sort((a, b) => b.messageCount - a.messageCount),
    );
    const serverGroups = Array.from(servers.values()).sort((a, b) => b.messageCount - a.messageCount);
    for (const group of serverGroups) {
      group.channels.sort(
        (a, b) =>
          Number(getPackageChannelCategory(a) === 'thread') - Number(getPackageChannelCategory(b) === 'thread') ||
          b.messageCount - a.messageCount,
      );
    }
    return { map, serverGroups };
  }, [filtered]);

  // 2.2.8: the sidebar Multi-select. Left Servers rows cannot be ticked
  // (Discord refuses deletes in a Server you are not in) and the run's
  // queue keeps showing its marks after Multi-select is switched off.
  const bulkRunning = bulk.status === 'running';
  const bulkFinished = bulk.status === 'done' || bulk.status === 'error';
  const canBulkDelete = !!token && !readOnly;
  const bulkDisabledReason = !token
    ? t('package.bulk.cannotDeleteSignIn')
    : readOnly
      ? t('package.bulk.cannotDeleteReadOnly')
      : null;
  const selectableIds = useMemo(
    () => filtered.filter((c) => !c.isOrphan).map((c) => c.id),
    [filtered],
  );
  const bulkSelectedSet = useMemo(() => new Set(bulkSelected), [bulkSelected]);
  const selectedVisibleCount = selectableIds.filter((id) => bulkSelectedSet.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedVisibleCount === selectableIds.length;
  const showChecks = multiSelectMode && !bulkRunning;
  const marks = useMemo(() => {
    const m: Record<string, BulkDeleteChannelState> = {};
    if (bulk.status === 'idle' || bulk.status === 'counting') return m;
    for (const id of bulk.queue) m[id] = bulk.outcomes[id]?.state ?? 'pending';
    return m;
  }, [bulk]);

  const handleToggleMultiSelect = () => {
    if (multiSelectMode) dispatch(clearBulkChannelSelection());
    setMultiSelectMode((v) => !v);
  };
  const handleToggleAll = () => {
    if (allSelected) {
      dispatch(setBulkChannelSelection(bulkSelected.filter((id) => !selectableIds.includes(id))));
    } else {
      dispatch(setBulkChannelSelection([...bulkSelected, ...selectableIds]));
    }
  };
  /** 2.2.9: the Server header checkbox ticks every channel under it, or clears them when all are ticked. */
  const handleToggleServer = (group: ServerGroup) => {
    const ids = group.channels.filter((c) => !c.isOrphan).map((c) => c.id);
    const allOn = ids.length > 0 && ids.every((id) => bulkSelectedSet.has(id));
    const rest = bulkSelected.filter((id) => !ids.includes(id));
    dispatch(setBulkChannelSelection(allOn ? rest : [...rest, ...ids]));
  };
  const handleCopyNames = useCallback(() => {
    if (!parsed) return;
    const names = parsed.channels.filter((c) => bulkSelectedSet.has(c.id)).map((c) => getPackageChannelLabel(c));
    void navigator.clipboard?.writeText(names.join('\n'));
  }, [parsed, bulkSelectedSet]);
  // The dialog lists channels in sidebar order, not tick order.
  const orderedSelection = useMemo(() => {
    if (!parsed) return [];
    return parsed.channels.filter((c) => bulkSelectedSet.has(c.id)).map((c) => c.id);
  }, [parsed, bulkSelectedSet]);
  // A finished run leaves Multi-select off so the marks read as a result, not a selection.
  useEffect(() => {
    if (bulkRunning) setMultiSelectMode(false);
  }, [bulkRunning]);

  if (!parsed) {
    // Main pane already shows the import CTA — keep the sidebar quiet.
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="caption" color="text.disabled">
          {t('package.importToBrowse')}
        </Typography>
      </Box>
    );
  }

  const sections: Array<{
    key: PackageChannelCategory;
    label: string;
    items: PackageChannel[];
  }> = [
    { key: 'guildText', label: t('package.sectionServers'), items: grouped.map.guildText },
    { key: 'thread', label: t('package.sectionThreads'), items: grouped.map.thread },
    { key: 'dm', label: t('package.sectionDms'), items: grouped.map.dm },
    { key: 'groupDm', label: t('package.sectionGroupDms'), items: grouped.map.groupDm },
    { key: 'orphan', label: t('package.sectionLeftServers'), items: grouped.map.orphan },
    { key: 'unknown', label: t('package.sectionOther'), items: grouped.map.unknown },
  ];
  const serverChannelCount = grouped.serverGroups.reduce((n, g) => n + g.channels.length, 0);
  const countOf = (key: PackageChannelCategory, items: PackageChannel[]) =>
    key === 'guildText' ? items.length + serverChannelCount : items.length;

  const totalShown = sections.reduce((n, s) => n + countOf(s.key, s.items), 0);

  const renderRow = (channel: PackageChannel, inServer = false) => (
    <ChannelRow
      key={channel.id}
      channel={channel}
      inServer={inServer}
      selected={showChecks ? bulkSelectedSet.has(channel.id) : channel.id === selectedId}
      check={showChecks ? (channel.isOrphan ? 'blocked' : bulkSelectedSet.has(channel.id) ? 'on' : 'off') : null}
      mark={marks[channel.id] ?? null}
      onSelect={() => {
        if (showChecks) {
          if (!channel.isOrphan) dispatch(toggleBulkChannelSelection(channel.id));
        } else {
          dispatch(selectPackageChannel(channel.id));
        }
      }}
    />
  );

  return (
    <>
      {bulkRunning ? (
        <BulkRunningBar
          current={bulk.queue.indexOf(bulk.currentChannelId ?? '') + 1}
          total={bulk.queue.length}
          channel={parsed.channels.find((c) => c.id === bulk.currentChannelId) ?? null}
          messagesDone={bulk.progress?.messagesDone ?? 0}
          messagesTotal={bulk.progress?.messagesTotal ?? 0}
          skipRequested={bulk.skipRequested}
          onSkip={() => dispatch(requestBulkSkip())}
        />
      ) : bulkFinished ? (
        <BulkFinishedNote
          cancelled={bulk.cancelled}
          error={bulk.error}
          outcomes={Object.values(bulk.outcomes)}
          onDismiss={() => dispatch(dismissBulkDelete())}
        />
      ) : (
        <Box sx={{ px: 1.5, pt: 1, pb: multiSelectMode ? 0.5 : 1 }}>
          <Tooltip title={bulkDisabledReason ?? ''} disableHoverListener={canBulkDelete}>
            <span>
              <Button
                size="small"
                onClick={handleToggleMultiSelect}
                variant={multiSelectMode ? 'contained' : 'outlined'}
                color={multiSelectMode ? 'primary' : 'inherit'}
                disabled={!canBulkDelete}
                aria-label={t('nav.toggleMultiSelect')}
                startIcon={multiSelectMode ? <SelectModeIcon fontSize="small" /> : <SelectModeOffIcon fontSize="small" />}
                data-testid="package-multi-select-toggle"
                sx={{ textTransform: 'none' }}
              >
                {t('nav.multiSelect')}
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}
      <MultiSelectControls
        active={showChecks}
        selectedCount={selectedVisibleCount}
        totalCount={selectableIds.length}
        allSelected={allSelected}
        onToggleAll={handleToggleAll}
        onPurge={() => setBulkDialogOpen(true)}
        purgeLabel={t('package.bulk.delete')}
        onCopyNames={handleCopyNames}
        noun={t('package.bulk.nounChannels')}
      />
      <BulkPackageDeleteDialog
        open={bulkDialogOpen}
        onClose={() => setBulkDialogOpen(false)}
        channelIds={orderedSelection}
      />
      {emptyCount > 0 && (
        <Box sx={{ px: 1.5, py: 1 }}>
          <Button
            size="small"
            fullWidth
            variant="text"
            startIcon={showEmpty ? <HideIcon /> : <ShowIcon />}
            onClick={() => setShowEmpty((v) => !v)}
            sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
          >
            {showEmpty
              ? t('package.hideEmpty', { count: emptyCount })
              : t('package.showEmpty', { count: emptyCount })}
          </Button>
        </Box>
      )}

      {totalShown === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          {t('package.noChannelsMatch')}
        </Typography>
      ) : (
        <List dense disablePadding>
          {sections.map(
            (section) =>
              countOf(section.key, section.items) > 0 && (
                <SidebarSection
                  key={section.key}
                  label={section.label}
                  count={countOf(section.key, section.items)}
                  collapsed={collapsed[section.key]}
                  onToggle={() =>
                    setCollapsed((c) => ({ ...c, [section.key]: !c[section.key] }))
                  }
                  action={
                    section.key === 'orphan' && token ? (
                      <Tooltip title={t('package.recheckLeftServers')}>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={t('package.recheckLeftServers')}
                            disabled={recheckStatus === 'running'}
                            onClick={() => void dispatch(recheckLeftServers())}
                            sx={{ p: 0.25 }}
                          >
                            <Refresh fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    ) : null
                  }
                >
                  {section.key === 'guildText' &&
                    grouped.serverGroups.map((group) => {
                      const ticked = group.channels.filter((c) => bulkSelectedSet.has(c.id)).length;
                      return (
                        <ServerGroupHeader
                          key={group.key}
                          group={group}
                          collapsed={!!collapsedServers[group.key]}
                          onToggle={() => setCollapsedServers((c) => ({ ...c, [group.key]: !c[group.key] }))}
                          check={!showChecks ? null : ticked === 0 ? 'off' : ticked === group.channels.length ? 'on' : 'some'}
                          onCheck={() => handleToggleServer(group)}
                        >
                          {group.channels.map((channel) => renderRow(channel, true))}
                        </ServerGroupHeader>
                      );
                    })}
                  {section.items.map((channel) => renderRow(channel))}
                </SidebarSection>
              ),
          )}
        </List>
      )}
    </>
  );
};

/** 2.2.9: one Server's channels and threads in the package sidebar. */
interface ServerGroup {
  key: string;
  name: string;
  channels: PackageChannel[];
  messageCount: number;
}

/** The Server a package channel sits under, or '' when the package names none. */
function serverKeyOf(channel: PackageChannel): string {
  return channel.guildId || channel.guildName || '';
}

interface ServerGroupHeaderProps {
  group: ServerGroup;
  collapsed: boolean;
  onToggle: () => void;
  /** Multi-select state of the whole Server; null when Multi-select is off. */
  check: 'on' | 'off' | 'some' | null;
  onCheck: () => void;
  children: React.ReactNode;
}

/** 2.2.9: a Server's name, its channel and message counts, the fold arrow and, in Multi-select, a checkbox for everything under it. */
const ServerGroupHeader = ({ group, collapsed, onToggle, check, onCheck, children }: ServerGroupHeaderProps) => {
  const { t } = useTranslation();
  const name = group.name || t('pkgAnalytics.unknownServer');
  // Like the rows (#236), the header counts what is left, not what the archive held.
  const remaining = useAppSelector((state) =>
    group.channels.reduce(
      (n, c) => n + Math.max(c.messageCount - (state.package.deletedMessageIds[c.id]?.length ?? 0), 0),
      0,
    ),
  );
  return (
    <>
      <Box
        data-testid="package-server-group"
        data-server={group.key}
        sx={{ display: 'flex', alignItems: 'center', pl: '15px', pr: 1.5, py: 0.75 }}
      >
        {check !== null && (
          <Checkbox
            size="small"
            checked={check === 'on'}
            indeterminate={check === 'some'}
            onChange={onCheck}
            inputProps={{ 'aria-label': t('package.bulk.selectServerAria', { name }) }}
            data-testid="package-server-tick"
            sx={{ p: 0, mr: 1 }}
          />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0, cursor: 'pointer' }} onClick={onToggle}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {t('package.serverChannels', { count: group.channels.length })}
            {' · '}
            {t('package.serverMessages', { count: remaining })}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={onToggle}
          aria-label={t('package.toggleServer', { name })}
          aria-expanded={!collapsed}
          sx={{ p: 0.25 }}
        >
          {collapsed ? <ExpandMore fontSize="small" /> : <ExpandLess fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={!collapsed} unmountOnExit>
        {children}
      </Collapse>
    </>
  );
};

interface SidebarSectionProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** #273: an extra control between the count and the collapse arrow. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

const SidebarSection = ({
  label,
  count,
  collapsed,
  onToggle,
  action,
  children,
}: SidebarSectionProps) => (
  <>
    <ListSubheader
      disableSticky
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        lineHeight: 1.8,
        backgroundColor: 'transparent',
        px: 1.5,
        color: 'text.secondary',
        fontSize: '0.7rem',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      <Box sx={{ flexGrow: 1 }}>{label}</Box>
      <Chip
        label={count}
        size="small"
        variant="outlined"
        sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
      />
      {action}
      <IconButton size="small" onClick={onToggle} sx={{ p: 0.25 }}>
        {collapsed ? <ExpandMore fontSize="small" /> : <ExpandLess fontSize="small" />}
      </IconButton>
    </ListSubheader>
    <Collapse in={!collapsed} unmountOnExit>
      {children}
    </Collapse>
  </>
);

interface ChannelRowProps {
  channel: PackageChannel;
  /** 2.2.9: the row sits under its Server's header, so it is indented and drops the Server name line. */
  inServer?: boolean;
  selected: boolean;
  /** 2.2.8: Multi-select state of the row; null when Multi-select is off. Blocked rows are Left Servers. */
  check: 'on' | 'off' | 'blocked' | null;
  /** 2.2.8: the row's place in a bulk run, shown as a dot like the Operator queue. */
  mark: BulkDeleteChannelState | null;
  onSelect: () => void;
}

const MARK_COLOR: Record<BulkDeleteChannelState, string> = {
  pending: 'text.disabled',
  running: 'primary.main',
  done: 'success.main',
  skipped: 'warning.main',
};

const ChannelRow = ({ channel, inServer = false, selected, check, mark, onSelect }: ChannelRowProps) => {
  const { t } = useTranslation();
  const primary = getPackageChannelLabel(channel);
  const subtitle = getPackageChannelSubtitle(channel);
  const category = getPackageChannelCategory(channel);
  // #236: the archive's messageCount is import-time static; deletions
  // made through Discrub live in the deleted cache. Show the live
  // remaining count (display-only — pkg:meta is never rewritten).
  const deletedCount = useAppSelector(
    selectChannelDeletedMessageCount(channel.id),
  );
  const goneCount = useAppSelector(selectChannelGoneMessageCount(channel.id));
  const remainingCount = Math.max(channel.messageCount - deletedCount, 0);
  const countLabel =
    channel.messageCount === 0
      ? t('package.empty')
      : remainingCount.toLocaleString(i18next.language);

  return (
    <ListItemButton
      selected={selected}
      onClick={onSelect}
      disabled={check === 'blocked'}
      data-testid="package-channel-row"
      data-bulk-mark={mark ?? undefined}
      sx={{
        pl: inServer ? 3.5 : 1.5,
        pr: 1.5,
        py: 0.75,
        opacity: check === 'blocked' ? 0.4 : channel.isOrphan ? 0.82 : 1,
        borderLeft: '3px solid transparent',
        borderLeftColor: channel.isOrphan
          ? 'warning.main'
          : selected
            ? 'primary.main'
            : 'transparent',
      }}
    >
      {check !== null && check !== 'blocked' && (
        <Checkbox
          size="small"
          checked={check === 'on'}
          tabIndex={-1}
          disableRipple
          inputProps={{ 'aria-label': t('package.bulk.selectAria', { name: primary }) }}
          data-testid="package-bulk-tick"
          sx={{ p: 0, mr: 1 }}
        />
      )}
      {mark && (
        <Box data-testid={`package-bulk-mark-${mark}`} sx={{ width: 8, height: 8, borderRadius: '50%', mr: 1, flexShrink: 0, backgroundColor: MARK_COLOR[mark] }} />
      )}
      <ChannelIcon category={category} />
      <Box sx={{ flexGrow: 1, minWidth: 0, ml: 1 }}>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography
            variant="body2"
            noWrap
            sx={{
              fontWeight: selected ? 600 : 500,
              color: channel.name ? 'text.primary' : 'text.secondary',
              fontStyle: channel.name ? 'normal' : 'italic',
              flexGrow: 1,
            }}
          >
            {primary}
          </Typography>
          {deletedCount > 0 ? (
            <Tooltip
              title={formatProvenanceTooltip(channel.messageCount, deletedCount, goneCount)}
            >
              <Typography
                variant="caption"
                color={channel.messageCount === 0 ? 'text.disabled' : 'text.secondary'}
                sx={{ flexShrink: 0 }}
              >
                {countLabel}
              </Typography>
            </Tooltip>
          ) : (
            <Typography
              variant="caption"
              color={channel.messageCount === 0 ? 'text.disabled' : 'text.secondary'}
              sx={{ flexShrink: 0 }}
            >
              {countLabel}
            </Typography>
          )}
        </Stack>
        {!inServer && (
          <Typography
            variant="caption"
            noWrap
            sx={{
              color: channel.isOrphan ? 'warning.main' : 'text.secondary',
              display: 'block',
            }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    </ListItemButton>
  );
};

interface BulkRunningBarProps {
  current: number;
  total: number;
  channel: PackageChannel | null;
  messagesDone: number;
  messagesTotal: number;
  skipRequested: boolean;
  onSkip: () => void;
}

/** 2.2.8: which channel the run is on and how far along, with the Skip control. Pause and stop live in the status log. */
const BulkRunningBar = ({ current, total, channel, messagesDone, messagesTotal, skipRequested, onSkip }: BulkRunningBarProps) => {
  const { t } = useTranslation();
  const pct = messagesTotal > 0 ? Math.min(100, (messagesDone / messagesTotal) * 100) : 0;
  return (
    <Stack spacing={0.75} sx={{ px: 2, pt: 1.25, pb: 1 }} data-testid="package-bulk-running">
      <Typography variant="caption" color="text.secondary" noWrap>
        {t('package.bulk.running', { current: Math.max(1, current), total, channel: channel ? getPackageChannelLabel(channel) : '' })}
      </Typography>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 4, borderRadius: 2 }} />
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {t('package.bulk.runningCount', { done: messagesDone, total: messagesTotal })}
        </Typography>
        <Typography variant="caption" color="text.disabled">·</Typography>
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          disabled={skipRequested}
          onClick={onSkip}
          data-testid="package-bulk-skip"
          sx={{ color: 'primary.main', cursor: 'pointer' }}
        >
          {t('package.bulk.skip')}
        </Link>
      </Stack>
      <Typography variant="caption" color="text.disabled">{t('package.bulk.controlsHint')}</Typography>
    </Stack>
  );
};

interface BulkFinishedNoteProps {
  cancelled: boolean;
  error: string | null;
  outcomes: Array<{ result?: { deleted: number; alreadyGone: number; forbidden: number; failed: number } }>;
  onDismiss: () => void;
}

/** 2.2.8: the run's totals, kept until dismissed so the marks in the list mean something. */
const BulkFinishedNote = ({ cancelled, error, outcomes, onDismiss }: BulkFinishedNoteProps) => {
  const { t } = useTranslation();
  const hasFailures = useAppSelector(selectFailureCount('package')) > 0;
  const sum = outcomes.reduce(
    (acc, o) => ({
      deleted: acc.deleted + (o.result?.deleted ?? 0),
      gone: acc.gone + (o.result?.alreadyGone ?? 0),
      failed: acc.failed + (o.result?.failed ?? 0) + (o.result?.forbidden ?? 0),
    }),
    { deleted: 0, gone: 0, failed: 0 },
  );
  return (
    <Box sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
      <Alert
        severity={error ? 'error' : cancelled || sum.failed > 0 ? 'warning' : 'success'}
        variant="outlined"
        sx={{ py: 0.25, '& .MuiAlert-message': { fontSize: '0.78rem' } }}
        onClose={onDismiss}
        data-testid="package-bulk-finished"
      >
        {error ?? t(cancelled ? 'package.bulk.stopped' : 'package.bulk.finished', sum)}
        {/* 2.2.9 (GitHub issue 23): the run kept a record of what it could not delete. */}
        {hasFailures && <SaveFailedListLink source="package" block />}
      </Alert>
    </Box>
  );
};

const ICON_SX = { fontSize: 18, color: 'text.secondary', flexShrink: 0 };

const ChannelIcon = ({ category }: { category: PackageChannelCategory }) => {
  switch (category) {
    case 'dm':
      return (
        <Avatar
          sx={{
            width: 22,
            height: 22,
            bgcolor: 'action.selected',
            color: 'text.primary',
          }}
        >
          <DmIcon sx={{ fontSize: 14 }} />
        </Avatar>
      );
    case 'groupDm':
      return <GroupDmIcon sx={ICON_SX} />;
    case 'thread':
      return <ThreadIcon sx={ICON_SX} />;
    case 'orphan':
      return <ArchiveIcon sx={{ ...ICON_SX, color: 'warning.main' }} />;
    case 'unknown':
      return <UnknownChannelIcon sx={{ ...ICON_SX, color: 'text.disabled' }} />;
    case 'guildText':
      return <TextChannelIcon sx={ICON_SX} />;
    default:
      return assertNever(category);
  }
};

function assertNever(value: never): never {
  throw new Error(`Unhandled package channel category: ${String(value)}`);
}

export default PackageChannelList;
