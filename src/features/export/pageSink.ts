import type { Message } from 'discrub-core/types/discord-types';
import { arraySource, storeSource, WINDOW_SIZE, type MessageSource } from '@services/messageSource';
import {
  deleteConversation,
  readWindow,
  updateConversation,
  writePage,
  WorkspaceQuotaError,
} from '@services/workspaceStore';
import type { ConversationSeed } from '@features/workspace/workspaceTypes';

/**
 * Where an export's walk puts the pages it fetches (2.2.5 WP6c). The
 * store sink writes each page to a run conversation in the workspace, so
 * the channel never sits whole in memory and a resumed run can render it
 * again from disk. The array sink keeps the pages in memory, for a
 * session without a workspace (tests) and as the fallback when the
 * browser's storage is full.
 */
export interface PageSink {
  /** Messages added so far. */
  readonly count: number;
  add(messages: Message[]): Promise<void>;
  /** What was added, to render from. */
  source(): MessageSource;
  /** The messages themselves when they are held in memory, null when they are on disk. */
  inMemory(): Message[] | null;
  /** Marks the run conversation finished, so a resumed run can trust it. */
  complete(): Promise<void>;
}

export function arraySink(): PageSink {
  const messages: Message[] = [];
  return {
    get count() {
      return messages.length;
    },
    async add(page) {
      messages.push(...page);
    },
    source: () => arraySource(messages),
    inMemory: () => messages,
    complete: async () => undefined,
  };
}

export interface StoreSinkOptions {
  wid: string;
  cid: string;
  seed: ConversationSeed;
  /** Called once if the store refuses a page; the sink then carries on in memory. */
  onStorageFull?: () => void;
}

export function storeSink({ wid, cid, seed, onStorageFull }: StoreSinkOptions): PageSink {
  let count = 0;
  let fallback: Message[] | null = null;

  const moveToMemory = async (): Promise<Message[]> => {
    const held: Message[] = [];
    let afterId: string | undefined;
    while (true) {
      let read: Message[];
      try {
        read = await readWindow(wid, cid, { afterId, limit: WINDOW_SIZE, direction: 'asc' });
      } catch {
        break;
      }
      held.push(...read);
      if (read.length < WINDOW_SIZE) break;
      afterId = read[read.length - 1].id;
    }
    await deleteConversation(wid, cid).catch(() => undefined);
    return held;
  };

  return {
    get count() {
      return count;
    },
    async add(page) {
      if (page.length === 0) return;
      if (fallback) {
        fallback.push(...page);
        count += page.length;
        return;
      }
      try {
        await writePage(wid, cid, page, seed);
        count += page.length;
      } catch (error) {
        if (error instanceof WorkspaceQuotaError) onStorageFull?.();
        else console.error('[workspace] export page write failed, continuing in memory', error);
        fallback = await moveToMemory();
        fallback.push(...page);
        count = fallback.length;
      }
    },
    source: () => (fallback ? arraySource(fallback) : storeSource(wid, cid, count)),
    inMemory: () => fallback,
    async complete() {
      if (fallback) return;
      try {
        await updateConversation(wid, cid, (conversation) => {
          conversation.complete = true;
        });
      } catch (error) {
        console.error('[workspace] could not mark the export run conversation complete', error);
      }
    },
  };
}
