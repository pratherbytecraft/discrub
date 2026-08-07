import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDiscordToken } from './tokenExtraction';

function createStorageMock(initialValues: Record<string, string | null> = {}): Storage {
  const values = { ...initialValues };

  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete values[key];
    }),
    clear: vi.fn(() => {
      Object.keys(values).forEach((key) => delete values[key]);
    }),
    key: vi.fn((index: number) => Object.keys(values)[index] ?? null),
    get length() {
      return Object.keys(values).length;
    },
  } as unknown as Storage;
}

describe('tokenExtraction', () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
  let pageStorage: Storage;

  beforeEach(() => {
    pageStorage = createStorageMock();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: pageStorage,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(window, 'localStorage', originalLocalStorage);
    }
    vi.restoreAllMocks();
  });

  it('extracts JSON-encoded token from localStorage', () => {
    localStorage.setItem('token', '"test-token-123"');

    expect(getDiscordToken()).toBe('test-token-123');
  });

  it('triggers beforeunload and retries localStorage before falling back', () => {
    window.addEventListener(
      'beforeunload',
      () => {
        localStorage.setItem('token', '"flushed-token-123"');
      },
      { once: true },
    );

    expect(getDiscordToken()).toBe('flushed-token-123');
  });

  it('falls back to same-origin iframe storage when page storage has no token', () => {
    const iframeStorage = createStorageMock({ token: '"iframe-token-123"' });
    const createElement = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = createElement(tagName);
      if (tagName.toLowerCase() === 'iframe') {
        Object.defineProperty(element, 'contentWindow', {
          configurable: true,
          value: { localStorage: iframeStorage },
        });
      }
      return element;
    }) as typeof document.createElement);

    expect(getDiscordToken()).toBe('iframe-token-123');
  });

  it('falls back to iframe storage when page localStorage is unavailable', () => {
    const iframeStorage = createStorageMock({ token: '"iframe-token-456"' });
    const createElement = document.createElement.bind(document);

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new ReferenceError('localStorage is not defined');
      },
    });

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = createElement(tagName);
      if (tagName.toLowerCase() === 'iframe') {
        Object.defineProperty(element, 'contentWindow', {
          configurable: true,
          value: { localStorage: iframeStorage },
        });
      }
      return element;
    }) as typeof document.createElement);

    expect(getDiscordToken()).toBe('iframe-token-456');
  });
});
