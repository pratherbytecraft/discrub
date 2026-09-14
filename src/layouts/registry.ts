import type { LayoutKey, LayoutShell } from './types';
import ClassicShell from './classic/ClassicShell';
import NativeShell from './native/NativeShell';
import WorkbenchShell from './workbench/WorkbenchShell';
import SimpleShell from './simple/SimpleShell';
import OperatorShell from './operator/OperatorShell';
import TimelineShell from './timeline/TimelineShell';

/**
 * Every layout that ships. Keys missing here fall back to Classic, so a
 * setting value from a newer build never renders nothing.
 */
export const LAYOUT_SHELLS: Partial<Record<LayoutKey, LayoutShell>> = {
  classic: ClassicShell,
  native: NativeShell,
  workbench: WorkbenchShell,
  simple: SimpleShell,
  operator: OperatorShell,
  timeline: TimelineShell,
};

export const resolveShell = (key: LayoutKey | undefined): LayoutShell => LAYOUT_SHELLS[key ?? 'classic'] ?? ClassicShell;
/** True once a layout has a shell; the menu marks the rest as coming soon. */
export const isLayoutBuilt = (key: LayoutKey): boolean => key in LAYOUT_SHELLS;
