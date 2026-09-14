import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  selectActiveFilteredMessages, selectActiveMessages, selectActivePagination, selectActiveTab,
  setRefineCriteria, setThreadRefineCriteria, navigateToMessage,
} from '@features/message/messageSlice';
import { applyRefineCriteria, type RefineCriteria } from '@features/message/messageFiltering';
import { defaultCriteria } from '@components/search/searchConstants';
import { localDayKey } from '@/utils/messageChunking';
import { buildTimeline, rangeToDates, type TimelineModel } from '@/utils/timelineDays';

export interface TimelineRange { from: string; to: string }

/**
 * What the Timeline strip, month list and header read. The bars count the
 * open conversation (or thread tab) with every filter applied except the
 * date range, so a dragged range never shrinks the strip it was dragged on.
 * While a Discord search is showing, the results are the only list there
 * is, so the bars count what is shown.
 */
export const useTimeline = (): {
  model: TimelineModel; shown: number; range: TimelineRange | null;
  setRange: (from: string, to: string) => void; clearRange: () => void; jumpTo: (messageId: string | null) => void;
} => {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector(selectActiveTab);
  const raw = useAppSelector(selectActiveMessages);
  const shownMessages = useAppSelector(selectActiveFilteredMessages);
  const pagination = useAppSelector(selectActivePagination);
  const refine = useAppSelector((s) => (activeTab ? s.message.threadTabs[activeTab]?.refineCriteria ?? null : s.message.refineCriteria)) as RefineCriteria | null;

  const base = useMemo(() => {
    if (pagination.mode === 'search') return shownMessages;
    return applyRefineCriteria(raw, refine ? { ...refine, searchAfterDate: null, searchBeforeDate: null } : null);
  }, [pagination.mode, raw, refine, shownMessages]);
  const model = useMemo(() => buildTimeline(base), [base]);

  const range = useMemo<TimelineRange | null>(() => {
    if (!refine?.searchAfterDate && !refine?.searchBeforeDate) return null;
    const from = refine.searchAfterDate ? localDayKey(new Date(refine.searchAfterDate).toISOString()) : model.firstDay;
    const to = refine.searchBeforeDate ? localDayKey(new Date(refine.searchBeforeDate).toISOString()) : model.lastDay;
    return { from, to };
  }, [refine, model.firstDay, model.lastDay]);

  const write = useCallback((criteria: RefineCriteria) => {
    if (activeTab) dispatch(setThreadRefineCriteria({ threadId: activeTab, criteria }));
    else dispatch(setRefineCriteria(criteria));
  }, [activeTab, dispatch]);
  const setRange = useCallback((from: string, to: string) => {
    const { after, before } = rangeToDates(from, to);
    write({ ...(refine ?? defaultCriteria), searchAfterDate: after, searchBeforeDate: before });
  }, [refine, write]);
  const clearRange = useCallback(() => {
    write({ ...(refine ?? defaultCriteria), searchAfterDate: null, searchBeforeDate: null });
  }, [refine, write]);
  const jumpTo = useCallback((messageId: string | null) => { if (messageId) void dispatch(navigateToMessage({ messageId })); }, [dispatch]);

  return { model, shown: shownMessages.length, range, setRange, clearRange, jumpTo };
};
