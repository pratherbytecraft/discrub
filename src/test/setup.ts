import '@testing-library/jest-dom';
// `fake-indexeddb/auto` registers an in-memory IndexedDB implementation
// on globalThis so the storage adapter (now backed by `idb-keyval`) works
// in jsdom. Must be imported before anything that touches `storage.ts`.
import 'fake-indexeddb/auto';
// Boots i18next with the bundled catalogs so `t()` resolves English in
// every test without per-file setup.
import '../i18n';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { installChromeMocks, cleanupChromeMocks } from './chrome-mocks';
import { clearMessageCache } from '@features/message/messageCache';
import { server as mswServer } from './msw/server';
import { webcrypto } from 'node:crypto';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { applyLanguage } from '../i18n';

// jsdom's crypto has getRandomValues but no SubtleCrypto; the supporter
// key verification needs WebCrypto Ed25519, so borrow Node's.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle });
}

// jsdom's Blob has neither `stream()` nor `arrayBuffer()`, and jsdom
// has no ReadableStream. The package import reads Files through
// `stream()` (#269), so give the test Blob the same surface, built on
// FileReader over small slices so the chunked path is exercised.
if (typeof globalThis.ReadableStream === 'undefined') {
  Object.defineProperty(globalThis, 'ReadableStream', { value: NodeReadableStream, writable: true, configurable: true });
}
const readSlice = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(blob);
  });
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function arrayBuffer(this: Blob) {
      return readSlice(this);
    },
  });
}
const TEST_STREAM_CHUNK = 8 * 1024;
const chunkedStream = (source: Blob): ReadableStream<Uint8Array> => {
  let offset = 0;
  return new (globalThis.ReadableStream as typeof ReadableStream)<Uint8Array>({
    async pull(controller) {
      if (offset >= source.size) {
        controller.close();
        return;
      }
      const end = Math.min(offset + TEST_STREAM_CHUNK, source.size);
      const buffer = await readSlice(source.slice(offset, end));
      offset = end;
      controller.enqueue(new Uint8Array(buffer));
    },
  });
};
if (typeof Blob.prototype.stream !== 'function') {
  Object.defineProperty(Blob.prototype, 'stream', {
    configurable: true,
    writable: true,
    value: function stream(this: Blob) {
      return chunkedStream(this);
    },
  });
}

// Install Chrome extension API mocks globally
beforeAll(() => {
  installChromeMocks();
  // MSW server runs for the whole test process. `bypass` means tests
  // that don't register handlers are unaffected — module-mocked tests
  // intercept before any fetch happens, so MSW never sees them.
  mswServer.listen({ onUnhandledRequest: 'bypass' });
});

// Cleanup Chrome mocks after all tests
afterAll(() => {
  cleanupChromeMocks();
  mswServer.close();
});

// Cleanup after each test. fake-indexeddb persists for the whole
// worker process; tests that care about clean storage state should
// `await idbClear()` themselves in `beforeEach`. We don't do it here
// globally because tests using `vi.useFakeTimers()` would block the
// afterEach hook on an idbClear promise that never resolves until
// real timers are restored.
afterEach(() => {
  cleanup();
  // A test that switched languages must not leak German into the next one.
  void applyLanguage('en');
  // Drop any per-test MSW handlers registered with `server.use(...)`.
  mswServer.resetHandlers();
});

// Mock window.matchMedia (required for MUI components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {}, // deprecated
    removeListener: () => {}, // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock IntersectionObserver (required for virtualization)
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// 2.2.5 WP2b: the message cache is module state; no test inherits another's objects.
afterEach(() => { clearMessageCache(); });
