if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  async function handleFetch(request) {
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
      return;
    }
    if (request.mode === "no-cors") {
      request = new Request(request.url, {
        cache: request.cache,
        credentials: "omit",
        headers: request.headers,
        integrity: request.integrity,
        destination: request.destination,
        keepalive: request.keepalive,
        method: request.method,
        mode: request.mode,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        signal: request.signal,
      });
    }
    let r = await fetch(request).catch((e) => console.error(e));
    if (r.status === 0) {
      return r;
    }
    const headers = new Headers(r.headers);
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return new Response(r.body, {
      status: r.status,
      statusText: r.statusText,
      headers,
    });
  }
  self.addEventListener("fetch", function (e) {
    e.respondWith(handleFetch(e.request));
  });
} else {
  (async function () {
    if (window.crossOriginIsolated !== false) return;
    let registration = await navigator.serviceWorker
      .register(window.document.currentScript.src)
      .catch((e) => console.error("COIMEP: registration failed", e));
    if (registration) {
      console.log("COIMEP: registered");
      registration.addEventListener("updatefound", () =>
        console.log("COIMEP: updatefound")
      );
      if (registration.waiting) {
        registration.waiting.postMessage("skipWaiting");
      }
      if (registration.active && !navigator.serviceWorker.controller) {
        window.location.reload();
      }
    }
  })();
}
