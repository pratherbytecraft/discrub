/** True on a Mac, read from the user agent hints when the browser has them. */
export function isMacOS(nav: Navigator = navigator): boolean {
  const hinted = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (hinted) return /mac/i.test(hinted);
  return /Mac/i.test(nav.platform || '') || /Macintosh/i.test(nav.userAgent || '');
}
