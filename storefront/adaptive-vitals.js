(function adaptiveStorefrontVitals(root) {
  "use strict";

  if (!root.PerformanceObserver) return;
  var lcp = 0;
  var cls = 0;
  var inp = 0;
  var sent = false;

  function observe(type, callback, options) {
    try {
      new root.PerformanceObserver(function collect(list) {
        list.getEntries().forEach(callback);
      }).observe(options || { type: type, buffered: true });
    } catch (_error) {
      void _error;
    }
  }

  observe("largest-contentful-paint", function recordLcp(entry) {
    lcp = entry.startTime;
  });
  observe("layout-shift", function recordShift(entry) {
    if (!entry.hadRecentInput) cls += entry.value;
  });
  observe(
    "event",
    function recordInteraction(entry) {
      if (entry.interactionId && entry.duration > inp) inp = entry.duration;
    },
    { type: "event", buffered: true, durationThreshold: 16 },
  );

  function publish() {
    if (sent) return;
    var analytics = root.Shopify && root.Shopify.analytics;
    if (!analytics || typeof analytics.publish !== "function") return;
    sent = true;
    var result = analytics.publish("adaptive_storefront_vitals", {
      schemaVersion: 1,
      lcpMs: Math.round(lcp),
      clsMilli: Math.round(cls * 1000),
      inpMs: Math.round(inp),
    });
    if (result && typeof result.catch === "function") {
      result.catch(function ignorePublishError() {});
    }
  }

  root.setTimeout(publish, 6000);
  root.addEventListener("pagehide", publish, { once: true });
})(typeof window !== "undefined" ? window : globalThis);
