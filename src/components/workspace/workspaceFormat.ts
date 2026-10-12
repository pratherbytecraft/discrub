import { t } from '@/i18n';
import type { WorkSummary } from '@features/workspace/workspaceSummary';

/** "Export 3 of 12", "Load All 48,200", "Purge". */
export function workLabel(work: WorkSummary, locale?: string): string {
  const of = work.done !== undefined && work.total !== undefined;
  switch (work.kind) {
    case 'loadAll':
      return t('workspace.workLoadAll', { count: (work.count ?? 0).toLocaleString(locale) });
    case 'export':
      return of ? t('workspace.workExportOf', { done: work.done, total: work.total }) : t('workspace.workExport');
    case 'purge':
      return of ? t('workspace.workPurgeOf', { done: work.done, total: work.total }) : t('workspace.workPurge');
    case 'edit':
      return t('workspace.workEditOf', { done: work.done ?? 0, total: work.total ?? 0 });
  }
}

/** "4 conversations" with the number in the reader's locale. */
export function countLabel(key: 'workspaces' | 'conversations' | 'messages', count: number, locale?: string): string {
  return t(`workspace.${key}`, { count, formatted: count.toLocaleString(locale) });
}
