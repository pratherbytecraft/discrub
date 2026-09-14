/**
 * Pure helpers for translating between KeyboardEvent and the canonical
 * binding string format used in `HotkeysState.bindings`.
 *
 * Canonical form examples: "F", "Space", "/", "mod+,", "mod+.",
 * "Escape". The literal `mod` segment resolves to Cmd on Mac, Ctrl on
 * every other platform; storage stays platform-neutral so a user
 * roaming between Mac and Windows sees the same bindings on both.
 */

/**
 * Normalize a KeyboardEvent into the binding string our store uses,
 * or null if the event is purely a modifier keydown (Cmd by itself,
 * Shift held without another key, etc.).
 *
 * Alt is intentionally NOT folded into `mod` — Alt+letter combos
 * collide with Windows menu accelerators and several Linux WM
 * shortcuts. Reserve them.
 */
export function eventToBinding(e: KeyboardEvent): string | null {
  const key = e.key;
  if (key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt') {
    return null;
  }
  const mod = e.metaKey || e.ctrlKey;

  // Browsers report a literal space character for the spacebar; round-
  // trip it through the named token so the storage string is human-
  // readable and matches the Settings tab display.
  let token = key === ' ' ? 'Space' : key;
  if (/^[a-z]$/.test(token)) token = token.toUpperCase();
  // Shift only counts on letters (2.2.0, Ctrl Shift L opens Appearance). On
  // punctuation the browser already reports the shifted character ('?'), and
  // a Shift segment there would break the existing '?' and '/' bindings.
  const shift = e.shiftKey && /^[A-Z]$/.test(token);

  return `${mod ? 'mod+' : ''}${shift ? 'shift+' : ''}${token}`;
}

/**
 * Detect whether the runtime platform is macOS-flavored (including
 * iPad, which reports as Mac in modern Safari). Used only at the
 * display layer — bindings are stored as "mod+X" regardless.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return /macintosh|mac os x|iphone|ipad|ipod/.test(ua);
}

/**
 * Format a stored binding for display. `mod+,` becomes `⌘,` on Mac
 * and `Ctrl+,` elsewhere. Bare keys pass through. Returns an empty
 * string for empty/missing bindings so callers can string-compose
 * tooltips without conditionally hiding the modifier portion.
 */
export function formatBindingForDisplay(binding: string, mac = isMacPlatform()): string {
  if (!binding) return '';
  let rest = binding; const parts: string[] = [];
  if (rest.startsWith('mod+')) { rest = rest.slice('mod+'.length); parts.push(mac ? '⌘' : 'Ctrl+'); }
  if (rest.startsWith('shift+')) { rest = rest.slice('shift+'.length); parts.push(mac ? '⇧' : 'Shift+'); }
  return parts.join('') + rest;
}
