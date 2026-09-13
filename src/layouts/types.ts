import type { ComponentType } from 'react';

/** The layouts a user can pick in 2.2.0. `classic` is the 2.1 frame. */
export type LayoutKey = 'classic' | 'native' | 'workbench' | 'simple' | 'operator' | 'timeline';
export const LAYOUT_KEYS: LayoutKey[] = ['classic', 'native', 'workbench', 'simple', 'operator', 'timeline'];
export const DEFAULT_LAYOUT: LayoutKey = 'classic';
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
