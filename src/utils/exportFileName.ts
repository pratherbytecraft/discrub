/**
 * File and folder names inside an export. The download link cannot carry
 * anything but ASCII (see `urlSafeFileName`), so names keep only a to z and
 * digits. 2.2.9: a name with none of those (a Channel named in Chinese, an
 * emoji only name) used to come out empty, which gave `.zip` and
 * `-page-1.html`; it now gets a short code made from the name, the same one
 * every time, so links between the pages still agree.
 */
export function exportSlug(name: string): string {
  const slug = name.replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (slug || !name) return slug;
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `x${hash.toString(16).padStart(8, '0')}`;
}
