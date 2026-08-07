function normalizeToken(value: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed.trim();
    }
  } catch {
    // Discord has used both JSON-encoded and raw token values over time.
  }

  const unquoted = trimmed.replace(/^"|"$/g, '').trim();
  return unquoted || null;
}

function getStorageKeys(storage: Storage): string[] {
  const keys = new Set<string>();

  try {
    Object.keys(storage).forEach((key) => keys.add(key));
  } catch {
    // Some page-level storage wrappers can throw while enumerating.
  }

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.add(key);
    }
  } catch {
    // Keep any keys collected through Object.keys.
  }

  return [...keys];
}

function readDiscordTokenFromStorage(storage: Storage, source: string): string | null {
  try {
    const token = normalizeToken(storage.getItem('token'));
    if (token) return token;

    for (const key of getStorageKeys(storage)) {
      const lowerKey = key.toLowerCase();
      if (!lowerKey.includes('token') || lowerKey.includes('push')) continue;

      const value = storage.getItem(key);
      if (!value || value.length <= 50) continue;

      const alternateToken = normalizeToken(value);
      if (alternateToken) {
        console.log(`[Discrub Content] Found token in ${source} storage key: ${key}`);
        return alternateToken;
      }
    }
  } catch (error) {
    console.error(`[Discrub Content] Failed to read ${source} storage:`, error);
  }

  return null;
}

function readDiscordTokenFromIframeStorage(): string | null {
  const root = document.body || document.documentElement;
  if (!root) return null;

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';

  try {
    root.appendChild(iframe);
    const iframeStorage = iframe.contentWindow?.localStorage;
    return iframeStorage ? readDiscordTokenFromStorage(iframeStorage, 'iframe') : null;
  } catch (error) {
    console.error('[Discrub Content] Failed to read iframe storage:', error);
    return null;
  } finally {
    iframe.remove();
  }
}

function getPageStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch (error) {
    console.warn('[Discrub Content] Page localStorage unavailable:', error);
    return null;
  }
}

function readDiscordTokenFromPageStorage(): string | null {
  const storage = getPageStorage();
  return storage ? readDiscordTokenFromStorage(storage, 'page') : null;
}

export function getDiscordToken(): string | null {
  let token = readDiscordTokenFromPageStorage();
  if (token) return token;

  try {
    window.dispatchEvent(new Event('beforeunload'));
  } catch (error) {
    console.warn('[Discrub Content] Failed to trigger Discord token flush:', error);
  }

  token = readDiscordTokenFromPageStorage();
  if (token) return token;

  token = readDiscordTokenFromIframeStorage();
  if (token) return token;

  console.warn('[Discrub Content] Discord token not found in storage');
  return null;
}
