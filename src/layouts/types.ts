import type { ComponentType } from 'react';

/** The layouts a user can pick in 2.2.0. `classic` is the 2.1 frame. */
export type LayoutKey = 'classic' | 'native' | 'workbench' | 'simple' | 'operator' | 'timeline';
export const LAYOUT_KEYS: LayoutKey[] = ['classic', 'native', 'workbench', 'simple', 'operator', 'timeline'];
export const DEFAULT_LAYOUT: LayoutKey = 'classic';
/** Where a locked supporter layout falls back to (A13): the free headline layout. */
export const LOCKED_FALLBACK_LAYOUT: LayoutKey = 'native';
/** Display names, the same in every locale (product words). */
export const LAYOUT_NAMES: Record<LayoutKey, string> = { classic: 'Classic', native: 'Native', workbench: 'Workbench', simple: 'Simple', operator: 'Operator', timeline: 'Timeline' };

/** What the Appearance menu and the Settings cards say about each layout. Free ones need no key. */
export interface LayoutMeta { key: LayoutKey; name: string; blurb: string; free: boolean }
export const LAYOUT_META: LayoutMeta[] = [
  { key: 'classic', name: 'Classic', blurb: 'The 2.1 layout.', free: true },
  { key: 'native', name: 'Native', blurb: 'Looks like Discord.', free: true },
  { key: 'workbench', name: 'Workbench', blurb: 'A compact table.', free: false },
  { key: 'simple', name: 'Simple', blurb: 'One wide column.', free: false },
  { key: 'operator', name: 'Operator', blurb: 'Queue and progress up front.', free: false },
  { key: 'timeline', name: 'Timeline', blurb: 'Messages grouped by day.', free: false },
];
export const isLayoutFree = (key: LayoutKey): boolean => LAYOUT_META.find((m) => m.key === key)?.free ?? true;
export const isLayoutKey = (value: unknown): value is LayoutKey =>
  typeof value === 'string' && (LAYOUT_KEYS as string[]).includes(value);

/**
 * What MainLayout hands every shell. A shell owns the frame (bars, nav
 * column or rail, where the feed, status and progress live) and nothing
 * else: hooks, the tour, dialogs, modals and the toast stay in MainLayout
 * so they survive a layout swap.
 */
export interface ShellProps {
  /** Focus is on: hide navigation and side panels, keep the content. */
  focusedView: boolean;
  /** Phone-width sidebar drawer state, owned by MainLayout so it closes on navigation. */
  sidebarOpen: boolean;
  onSidebarOpen: () => void;
  onSidebarClose: () => void;
  /** The Ko-fi drawer is showing on the right (desktop, feed setting on, not in Focus). */
  drawerOpen: boolean;
  /** Starts the shell tour; shells pass it to the welcome panel. */
  onStartShellTour: () => void;
}

export type LayoutShell = ComponentType<ShellProps>;
