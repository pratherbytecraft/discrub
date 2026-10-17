import { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
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
  recheckLeftServers,
  selectChannelDeletedMessageCount,
  selectChannelGoneMessageCount,
  selectLeftServersRecheckStatus,
  selectPackageChannel,
  selectParsedPackage,
  selectSelectedPackageChannelId,
} from '@features/package/packageSlice';
import { formatProvenanceTooltip } from '@features/package/packageStatusCopy';
import type { PackageChannel } from '@features/package/packageTypes';
import {
  getPackageChannelCategory,
  getPackageChannelLabel,
  getPackageChannelSubtitle,
  type PackageChannelCategory,
} from '@features/package/packageDisplayUtils';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { nameIncludes } from '@utils/nameMatch';

interface PackageChannelListProps {
  filterText?: string;
}

/**
 * Sidebar channel browser for a loaded data package.
 *
 * Channels are grouped by category (servers / DMs / threads / left servers)
 * so the user can scan "what's in here" at a glance. Within each group
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
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<PackageChannelCategory, boolean>>({
    guildText: false,
    thread: false,
    dm: false,
    groupDm: false,
    orphan: true, // collapsed by default — less noise
    unknown: false,
  });

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
    for (const c of filtered) {
      map[getPackageChannelCategory(c)].push(c);
    }
    // Sort each bucket by message count desc.
    (Object.keys(map) as PackageChannelCategory[]).forEach((k) =>
      map[k].sort((a, b) => b.messageCount - a.messageCount),
    );
    return map;
  }, [filtered]);

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
    { key: 'guildText', label: t('package.sectionServers'), items: grouped.guildText },
    { key: 'thread', label: t('package.sectionThreads'), items: grouped.thread },
    { key: 'dm', label: t('package.sectionDms'), items: grouped.dm },
    { key: 'groupDm', label: t('package.sectionGroupDms'), items: grouped.groupDm },
    { key: 'orphan', label: t('package.sectionLeftServers'), items: grouped.orphan },
    { key: 'unknown', label: t('package.sectionOther'), items: grouped.unknown },
  ];

  const totalShown = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <>
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
              section.items.length > 0 && (
                <SidebarSection
                  key={section.key}
                  label={section.label}
                  count={section.items.length}
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
                  {section.items.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      selected={channel.id === selectedId}
                      onSelect={() => dispatch(selectPackageChannel(channel.id))}
                    />
                  ))}
                </SidebarSection>
              ),
          )}
        </List>
      )}
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
  selected: boolean;
  onSelect: () => void;
}

const ChannelRow = ({ channel, selected, onSelect }: ChannelRowProps) => {
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
      sx={{
        px: 1.5,
        py: 0.75,
        opacity: channel.isOrphan ? 0.82 : 1,
        borderLeft: '3px solid transparent',
        borderLeftColor: channel.isOrphan
          ? 'warning.main'
          : selected
            ? 'primary.main'
            : 'transparent',
      }}
    >
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
      </Box>
    </ListItemButton>
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
