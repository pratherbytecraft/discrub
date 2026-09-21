import { useCallback, useMemo, useRef } from 'react';
import { Box, Checkbox, Typography, alpha, useTheme } from '@mui/material';
import { ArrowDownward as DescIcon, ArrowUpward as AscIcon, AttachFile as AttachmentIcon } from '@mui/icons-material';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { SortDirection } from 'discrub-core/common-enum';
import type { Message } from 'discrub-core/types/discord-types';
import { selectSelectedGuild } from '@features/guild/guildSlice';
import { formatSystemMessage } from 'discrub-core/system-messages';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  selectActiveFilteredMessages, selectActiveSelectedMessages, selectActiveOrder, selectActiveTab,
  toggleMessageSelection, toggleThreadMessageSelection, selectAllMessages, deselectAllMessages,
  selectAllThreadMessages, deselectAllThreadMessages, setOrder, setThreadOrder,
} from '@features/message/messageSlice';
import { selectSettings } from '@features/app/appSlice';
import { format } from 'date-fns';
import { getDateLocale } from '@/i18n/dateLocale';

const ROW_HEIGHT = 36;

/**
 * Dense table presenter for the Workbench layout (2.2.0). One row per
 * message: checkbox, author, text, attachments, reactions and the date with
 * its year. The header carries Select all and the Date column sorts. Reads
 * and writes the same store the chunked feed does, so selection, sort and
 * every dialog behave the same in both presenters.
 */
const MessageTable = () => {
  const { t } = useTranslation();
  const guildName = useAppSelector(selectSelectedGuild)?.name;
  // A message with no text still says what it is, dim and italic: its files, the embed's title or text, or a sticker's name.
  // Until 2026-09-21 an embed-only row (a bot's report) had an empty cell.
  const standIn = (m: Message, files: number): string => {
    // A call, a pin, a join: the same sentence the feed shows, with the mention markup turned into a plain name.
    const system = formatSystemMessage(m, { guildName });
    if (system?.text) return system.text.replace(/<@!?(\d+)>/g, (_, id: string) => (id === m.author?.id ? (m.author?.global_name || m.author?.username || '@user') : '@user')).replace(/\*\*/g, '');
    if (files) return t('table.attachmentOnly', { count: files });
    const embed = m.embeds?.find((e) => e.title || e.description);
    if (embed) return t('table.embedOnly', { text: (embed.title || embed.description || '').replace(/\s+/g, ' ').slice(0, 140) });
    if (m.embeds?.length) return t('table.embed');
    const sticker = m.sticker_items?.[0]?.name;
    if (sticker) return t('table.stickerOnly', { name: sticker });
    return '';
  };
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const messages = useAppSelector(selectActiveFilteredMessages);
  const selected = useAppSelector(selectActiveSelectedMessages);
  const order = useAppSelector(selectActiveOrder);
  const activeTab = useAppSelector(selectActiveTab);
  const settings = useAppSelector(selectSettings);
  const selectedIds = useMemo(() => new Set(selected.map((m) => m.id)), [selected]);
  const allSelected = messages.length > 0 && selected.length === messages.length;

  const toggle = useCallback((message: Message) => {
    if (activeTab) dispatch(toggleThreadMessageSelection({ threadId: activeTab, message }));
    else dispatch(toggleMessageSelection(message));
  }, [activeTab, dispatch]);
  const toggleAll = useCallback(() => {
    if (allSelected) { if (activeTab) dispatch(deselectAllThreadMessages(activeTab)); else dispatch(deselectAllMessages()); }
    else if (activeTab) dispatch(selectAllThreadMessages(activeTab)); else dispatch(selectAllMessages());
  }, [activeTab, allSelected, dispatch]);
  const toggleSort = useCallback(() => {
    const next = { order: order.order === SortDirection.ASCENDING ? SortDirection.DESCENDING : SortDirection.ASCENDING, orderBy: 'timestamp' as const };
    if (activeTab) dispatch(setThreadOrder({ threadId: activeTab, order: next })); else dispatch(setOrder(next));
  }, [activeTab, dispatch, order.order]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: messages.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_HEIGHT, overscan: 30 });
  const stamp = (ts: string) => { try { return format(new Date(ts), `${settings?.dateFormat || 'MM/dd/yyyy'} ${settings?.timeFormat || 'h:mm aa'}`, { locale: getDateLocale() }); } catch { return ''; } };
  const cellSx = { px: 1, display: 'flex', alignItems: 'center', minWidth: 0, height: '100%', fontSize: '0.8rem' } as const;
  const grid = '40px 180px minmax(200px, 1fr) 70px 120px 150px';

  return (
    <Box data-testid="message-table" sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'auto', backgroundColor: 'background.paper' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: grid, minWidth: 640, height: 34, borderBottom: '1px solid', borderColor: 'divider', backgroundColor: alpha(theme.palette.text.primary, 0.04), fontSize: '0.7rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
        <Box sx={{ ...cellSx, px: 0.5 }}><Checkbox size="small" checked={allSelected} indeterminate={!allSelected && selected.length > 0} onChange={toggleAll} inputProps={{ 'aria-label': t('feed.selectAll') }} data-testid="table-select-all" sx={{ p: 0.5 }} /></Box>
        <Box sx={cellSx}>{t('table.author')}</Box>
        <Box sx={cellSx}>{t('table.message')}</Box>
        <Box sx={cellSx}>{t('table.files')}</Box>
        <Box sx={cellSx}>{t('table.reactions')}</Box>
        <Box component="button" type="button" onClick={toggleSort} data-testid="table-sort-date" aria-label={t('table.sortByDate')} sx={{ ...cellSx, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: 'inherit', background: 'none', border: 0, cursor: 'pointer', gap: 0.5, '&:hover': { color: 'text.primary' } }}>
          {t('table.date')}{order.order === SortDirection.DESCENDING ? <DescIcon sx={{ fontSize: 13 }} /> : <AscIcon sx={{ fontSize: 13 }} />}
        </Box>
      </Box>
      <Box ref={parentRef} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }} data-testid="message-table-scroll">
        <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: 640 }}>
          {virtualizer.getVirtualItems().map((row) => {
            const m = messages[row.index];
            const isSelected = selectedIds.has(m.id);
            const author = m.author?.global_name || m.author?.username || '';
            const files = m.attachments?.length ?? 0;
            return (
              <Box
                key={m.id}
                role="row"
                aria-selected={isSelected}
                data-testid="table-row"
                data-message-id={m.id}
                onClick={() => toggle(m)}
                sx={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: row.size, transform: `translateY(${row.start}px)`,
                  display: 'grid', gridTemplateColumns: grid, cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider',
                  backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.14) : 'transparent',
                  '&:hover': { backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.18) : alpha(theme.palette.text.primary, 0.04) },
                }}
              >
                <Box sx={{ ...cellSx, px: 0.5 }}><Checkbox size="small" checked={isSelected} tabIndex={-1} onClick={(e) => e.stopPropagation()} onChange={() => toggle(m)} inputProps={{ 'aria-label': t('table.selectRow') }} sx={{ p: 0.5 }} /></Box>
                <Box sx={{ ...cellSx, gap: 0.75 }}>
                  <Box component="img" src={m.author?.avatar ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=32` : undefined} alt="" sx={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, backgroundColor: 'action.hover' }} />
                  <Typography variant="body2" noWrap sx={{ fontSize: 'inherit', fontWeight: 600 }}>{author}</Typography>
                </Box>
                <Box sx={cellSx}><Typography variant="body2" noWrap data-testid={m.content ? undefined : 'table-standin'} sx={{ fontSize: 'inherit', ...(m.content ? {} : { color: 'text.secondary', fontStyle: 'italic' }) }}>{m.content || standIn(m, files)}</Typography></Box>
                <Box sx={{ ...cellSx, color: 'text.secondary', gap: 0.5 }}>{files > 0 && <><AttachmentIcon sx={{ fontSize: 14 }} />{files}</>}</Box>
                <Box sx={{ ...cellSx, gap: 0.5, overflow: 'hidden' }}>{(m.reactions ?? []).slice(0, 3).map((r, i) => <Box key={i} component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>{r.emoji?.name} {r.count}</Box>)}</Box>
                <Box sx={{ ...cellSx, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}><Typography variant="body2" noWrap sx={{ fontSize: 'inherit' }}>{stamp(m.timestamp)}</Typography></Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

export default MessageTable;
