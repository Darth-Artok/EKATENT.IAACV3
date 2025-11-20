const CACHE_NAME = 'iaac-fortnite-coach-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/index.tsx',
  // You might need to add other static assets here
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@latest/dist/coco-ssd.min.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return response from cache if found
        if (response) {
          return response;
        }

        // Otherwise, fetch from network
        return fetch(event.request.clone()).then(
          fetchResponse => {
            // Check if we received a valid response to cache.
            // We only cache successful responses (status 200).
            // This will correctly cache both 'basic' (same-origin) and 'cors' (cross-origin) type responses.
            if (!fetchResponse || fetchResponse.status !== 200) {
              return fetchResponse;
            }

            // Clone the response because it's a stream and can be consumed only once by browser and cache.
            const responseToCache = fetchResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                // Cache the request/response pair.
                cache.put(event.request, responseToCache);
              });

            return fetchResponse;
          }
        );
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
