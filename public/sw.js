/**
 * Dedicated service worker for drip-fs fetch interception.
 *
 * Registered by bridge.js. Handles:
 * - Message events: receives download metadata via MessagePort
 * - Fetch events: intercepts download URLs and responds with the stream
 *
 * Adapted from StreamSaver.js (https://github.com/jimmywarting/StreamSaver.js)
 * by Jimmy Wärting, used under the MIT License. Copyright (c) 2016 Jimmy Karl
 * Roland Wärting. See the LICENSE file for the full notice.
 */

var downloadMap = new Map();

/** Bytes the browser may take between two progress reports to the page. */
var ACK_EVERY_BYTES = 1024 * 1024;

/**
 * A stream that hands the browser one chunk each time it asks for one,
 * and tells the page how many bytes the browser has taken so far
 * ({ consumed }) and when it has taken the last one ({ done: true }).
 * The page uses that to hold its writes while the disk is behind, and
 * to end close() only when the download has all of its data.
 */
function createAckedStream(port) {
  var queue = [];
  var ended = false;
  var finished = false;
  var consumed = 0;
  var reported = 0;
  var controller = null;
  var waiting = null;

  function settle() {
    var resolve = waiting;
    waiting = null;
    if (resolve) resolve();
  }

  function pump() {
    if (!waiting || finished) return;
    if (queue.length > 0) {
      var chunk = queue.shift();
      consumed += chunk.byteLength;
      controller.enqueue(chunk);
      if (queue.length === 0 || consumed - reported >= ACK_EVERY_BYTES) {
        reported = consumed;
        port.postMessage({ consumed: consumed });
      }
      settle();
    } else if (ended) {
      finished = true;
      controller.close();
      port.postMessage({ consumed: consumed, done: true });
      settle();
    }
  }

  return new ReadableStream(
    {
      start: function (c) {
        controller = c;
        port.onmessage = function (evt) {
          if (finished) return;
          if (evt.data === 'end') {
            ended = true;
          } else if (evt.data === 'abort') {
            finished = true;
            queue.length = 0;
            controller.error('Download aborted');
            settle();
            return;
          } else {
            queue.push(evt.data);
          }
          pump();
        };
      },
      pull: function () {
        return new Promise(function (resolve) {
          waiting = resolve;
          pump();
        });
      },
      cancel: function () {
        finished = true;
        queue.length = 0;
        port.postMessage({ abort: true });
      },
    },
    { highWaterMark: 0 }
  );
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
  if (!event.ports || event.ports.length === 0) return;
  if (event.data === 'ping') return;

  var data = event.data;
  var port = event.ports[0];

  var downloadUrl =
    data.url ||
    self.registration.scope +
      Math.random().toString().slice(2) +
      '/' +
      (typeof data === 'string' ? data : data.filename);

  var metadata = { stream: null, data: data, port: port };

  var acked = !!(data && data.ack);

  if (data.readableStream) {
    metadata.stream = data.readableStream;
  } else if (data.transferringReadable) {
    port.onmessage = function (evt) {
      port.onmessage = null;
      metadata.stream = evt.data.readableStream;
    };
  } else if (acked) {
    metadata.stream = createAckedStream(port);
  } else {
    metadata.stream = new ReadableStream({
      start: function (controller) {
        port.onmessage = function (evt) {
          if (evt.data === 'end') return controller.close();
          if (evt.data === 'abort') {
            controller.error('Download aborted');
            return;
          }
          controller.enqueue(evt.data);
        };
      },
      cancel: function () {
        port.postMessage({ abort: true });
      },
    });
  }

  downloadMap.set(downloadUrl, metadata);
  port.postMessage(acked ? { download: downloadUrl, ack: true } : { download: downloadUrl });
});

self.addEventListener('fetch', function (event) {
  var url = event.request.url;

  if (url.endsWith('/ping')) {
    event.respondWith(new Response('pong'));
    return;
  }

  var metadata = downloadMap.get(url);
  if (!metadata) return;

  downloadMap.delete(url);

  var stream = metadata.stream;
  var data = metadata.data;
  var port = metadata.port;

  var headers = new Headers({
    'Content-Type': 'application/octet-stream; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Security-Policy': "default-src 'none'",
    'X-WebKit-CSP': "default-src 'none'",
    'X-XSS-Protection': '1; mode=block',
  });

  var dataHeaders = new Headers((data && data.headers) || {});
  if (dataHeaders.has('Content-Length')) {
    headers.set('Content-Length', dataHeaders.get('Content-Length'));
  }
  if (dataHeaders.has('Content-Disposition')) {
    headers.set('Content-Disposition', dataHeaders.get('Content-Disposition'));
  }

  event.respondWith(new Response(stream, { headers: headers }));
  port.postMessage({ debug: 'Download started' });
});
