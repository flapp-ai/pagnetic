import {register} from "@shopify/web-pixels-extension";

type PixelSettings = {
  endpoint?: string;
  shop?: string;
  token?: string;
};

type EventLike = {
  id: string;
  clientId?: string;
  name: string;
  timestamp: string;
  customData?: unknown;
  data?: unknown;
};

type DecisionReference = {
  schemaVersion?: number;
  decisionId: string;
  experimentId: string;
  visitorId?: string | null;
  sessionId: string;
  productId?: string | null;
  expiresAt?: string | null;
};

const DECISION_KEY = "adaptive-storefront:latest-decision";
const DELIVERY_ATTEMPTS = 3;
const DELIVERY_ATTEMPT_TIMEOUT_MS = 1_000;
const DELIVERY_QUEUE_LIMIT = 64;
const STORAGE_QUEUE_LIMIT = 16;
const STORAGE_READ_TIMEOUT_MS = 250;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nested(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) current = record(current)[key];
  return current;
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function productIdFor(event: EventLike) {
  return (
    text(nested(event.data, ["productVariant", "product", "id"])) ??
    text(nested(event.data, ["cartLine", "merchandise", "product", "id"])) ??
    text(nested(event.data, ["checkout", "lineItems", "0", "variant", "product", "id"]))
  );
}

function canonicalProduct(value: string | null) {
  return value && /^\d+$/.test(value) ? `gid://shopify/Product/${value}` : value;
}

function eventProducts(event: EventLike) {
  const items = nested(event.data, ["checkout", "lineItems"]);
  return new Set([
    canonicalProduct(productIdFor(event)),
    ...(Array.isArray(items) ? items.map((item) => canonicalProduct(text(nested(item, ["variant", "product", "id"])))) : []),
  ].filter((value): value is string => Boolean(value)));
}

function checkoutData(event: EventLike) {
  const checkout = record(record(event.data).checkout);
  const total = record(checkout.totalPrice);
  const order = record(checkout.order);
  return {
    checkoutToken: text(checkout.token),
    shopifyOrderId: text(order.id),
    data: {
      amount: typeof total.amount === "number" ? total.amount : Number(total.amount) || null,
      currencyCode: text(total.currencyCode, 8),
    },
  };
}

register(({analytics, browser, customerPrivacy, init, settings}) => {
  const config = settings as PixelSettings;
  if (!config.endpoint || !config.shop || !config.token) return;
  const endpoint = config.endpoint;
  const shop = config.shop;
  const token = config.token;
  let privacyEpoch = 0;
  type DeliveryTask = {
    epoch: number;
    event: EventLike;
    overrides: Record<string, unknown>;
    ready: Promise<unknown>;
    resolve: () => void;
  };
  type StorageTask = {
    epoch: number;
    kind: "CLEAR" | "SET";
    value?: string;
    resolve: () => void;
  };
  const deliveryQueue: DeliveryTask[] = [];
  const storageQueue: StorageTask[] = [];
  let delivering = false;
  let activeRequest: AbortController | null = null;
  let storageBusy = false;
  let privacy = init.customerPrivacy;
  let storageTrustedEpoch = measurementAllowed() ? privacyEpoch : -1;
  let latestDecision: {epoch: number; value: DecisionReference} | null = null;

  customerPrivacy.subscribe("visitorConsentCollected", (event) => {
    privacyEpoch += 1;
    privacy = event.customerPrivacy;
    activeRequest?.abort();
    activeRequest = null;
    for (const queued of deliveryQueue.splice(0)) queued.resolve();
    storageTrustedEpoch = -1;
    latestDecision = null;
    for (const queued of storageQueue.splice(0)) queued.resolve();
    queueDecisionClear(privacyEpoch);
  });

  function measurementAllowed() {
    return privacy.analyticsProcessingAllowed && privacy.preferencesProcessingAllowed;
  }

  function consentState() {
    return privacy.analyticsProcessingAllowed
      ? privacy.preferencesProcessingAllowed
        ? "analytics_and_preferences_allowed"
        : "analytics_allowed"
      : "analytics_denied";
  }

  async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), milliseconds);
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function runStorageTask(task: StorageTask) {
    try {
      if (task.kind === "CLEAR") {
        // Mutations intentionally have no deadline: localStorage offers no
        // cancellation. Releasing the serialization lock while a timed-out
        // remove can still settle would let it delete a newer epoch's write.
        await browser.localStorage.removeItem(DECISION_KEY);
        if (task.epoch === privacyEpoch) storageTrustedEpoch = privacyEpoch;
        return;
      }
      if (task.epoch !== privacyEpoch || !measurementAllowed() || !task.value) return;
      await browser.localStorage.setItem(DECISION_KEY, task.value);
      if (task.epoch === privacyEpoch && measurementAllowed()) {
        storageTrustedEpoch = privacyEpoch;
        return;
      }
      // No newer mutation can run until this cleanup settles, so an
      // unconditional clear is safe and cannot erase a later write.
      await browser.localStorage.removeItem(DECISION_KEY);
    } catch {
      // Storage is best effort; delivery remains independent and consent-bound.
    }
  }

  function pumpStorage() {
    if (storageBusy) return;
    storageBusy = true;
    void (async () => {
      while (storageQueue.length) {
        const task = storageQueue.shift();
        if (!task) break;
        try {
          await runStorageTask(task);
        } finally {
          task.resolve();
        }
      }
      storageBusy = false;
      if (storageQueue.length) pumpStorage();
    })();
  }

  function queueDecisionWrite(decision: DecisionReference, epoch: number) {
    if (epoch !== privacyEpoch || !measurementAllowed()) return Promise.resolve();
    latestDecision = {epoch, value: decision};
    if (storageQueue.length >= STORAGE_QUEUE_LIMIT) {
      const droppable = storageQueue.findIndex((task) => task.kind === "SET");
      if (droppable >= 0) storageQueue.splice(droppable, 1)[0]?.resolve();
      else return Promise.resolve();
    }
    const queued = new Promise<void>((resolve) => {
      storageQueue.push({ epoch, kind: "SET", value: JSON.stringify(decision), resolve });
    });
    pumpStorage();
    return queued;
  }

  function queueDecisionClear(epoch: number) {
    const queued = new Promise<void>((resolve) => {
      storageQueue.push({ epoch, kind: "CLEAR", resolve });
    });
    pumpStorage();
    return queued;
  }

  function validDecision(decision: DecisionReference, products: Set<string>) {
    if (!text(decision.decisionId) || !text(decision.sessionId)) return false;
    if (decision.schemaVersion !== 2)
      return Boolean(
        decision.productId &&
        products.has(canonicalProduct(decision.productId)!),
      );
    const expiresAt = Date.parse(decision.expiresAt || "");
    return Boolean(
      decision.productId &&
      products.has(canonicalProduct(decision.productId)!) &&
      Number.isFinite(expiresAt) &&
      Date.now() < expiresAt,
    );
  }

  async function readDecision(products: Set<string>): Promise<DecisionReference | null> {
    try {
      if (!measurementAllowed()) return null;
      if (
        latestDecision?.epoch === privacyEpoch &&
        validDecision(latestDecision.value, products)
      ) return latestDecision.value;
      // A consent transition makes the prior persistent value untrusted until
      // its serialized clear has actually settled. Delivery remains live and
      // can use a fresh in-memory decision while storage is unavailable.
      if (storageTrustedEpoch !== privacyEpoch) return null;
      const stored = await deadline(
        browser.localStorage.getItem(DECISION_KEY),
        STORAGE_READ_TIMEOUT_MS,
      );
      const parsed = JSON.parse(stored || "null") as DecisionReference | null;
      return parsed && validDecision(parsed, products) ? parsed : null;
    } catch {
      return null;
    }
  }

  async function send(event: EventLike, overrides: Record<string, unknown> = {}) {
    if (!measurementAllowed()) return;
    const epoch = privacyEpoch;
    const products = eventProducts(event);
    const explicitProduct = canonicalProduct(text(overrides.productId));
    if (explicitProduct) products.add(explicitProduct);
    const decision = await readDecision(products);
    if (!measurementAllowed() || privacyEpoch !== epoch) return;
    const productId = canonicalProduct(decision?.productId ?? productIdFor(event));
    const payload = {
      schemaVersion: decision?.schemaVersion === 1 ? 1 : 2,
      shop,
      token,
      eventId: event.id,
      eventType: event.name,
      occurredAt: event.timestamp,
      clientId: event.clientId ?? null,
      consentState: consentState(),
      decisionId: decision?.decisionId ?? null,
      experimentId: decision?.experimentId ?? null,
      visitorId: decision?.visitorId ?? null,
      sessionId: decision?.sessionId ?? null,
      productId,
      ...overrides,
    };
    const body = JSON.stringify(payload);
    for (let attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt += 1) {
      if (!measurementAllowed() || privacyEpoch !== epoch) return;
      const controller = typeof AbortController === "function"
        ? new AbortController()
        : null;
      activeRequest = controller;
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const response = await Promise.race([
          fetch(endpoint, {
            method: "POST",
            body,
            headers: {"Content-Type": "text/plain;charset=UTF-8"},
            keepalive: true,
            ...(controller ? {signal: controller.signal} : {}),
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller?.abort();
              reject(new Error("PIXEL_DELIVERY_TIMEOUT"));
            }, DELIVERY_ATTEMPT_TIMEOUT_MS);
          }),
        ]);
        if (!measurementAllowed() || privacyEpoch !== epoch) return;
        if (response.ok || response.status < 500) return;
      } catch {
        // Retry transient network failures without affecting the storefront.
      } finally {
        if (timer !== null) clearTimeout(timer);
        if (activeRequest === controller) activeRequest = null;
      }
      if (!measurementAllowed() || privacyEpoch !== epoch) return;
      if (attempt < DELIVERY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      }
    }
  }

  function pumpDelivery() {
    if (delivering) return;
    delivering = true;
    void (async () => {
      while (deliveryQueue.length) {
        const task = deliveryQueue.shift()!;
        try {
          await task.ready.catch(() => undefined);
          if (task.epoch === privacyEpoch && measurementAllowed())
            await send(task.event, task.overrides);
        } finally {
          task.resolve();
        }
      }
      delivering = false;
      if (deliveryQueue.length) pumpDelivery();
    })();
  }

  function queueSend(
    event: EventLike,
    overrides: Record<string, unknown> = {},
    ready: Promise<unknown> = Promise.resolve(),
  ) {
    const epoch = privacyEpoch;
    if (!measurementAllowed()) return Promise.resolve();
    if (deliveryQueue.length + (delivering ? 1 : 0) >= DELIVERY_QUEUE_LIMIT)
      return Promise.resolve();
    const queued = new Promise<void>((resolve) => {
      deliveryQueue.push({ epoch, event, overrides, ready, resolve });
    });
    pumpDelivery();
    return queued;
  }

  analytics.subscribe("adaptive_storefront_decision", async (shopifyEvent) => {
    if (!measurementAllowed()) return;
    const epoch = privacyEpoch;
    const event = shopifyEvent as unknown as EventLike;
    const detail = record(event.customData);
    const decisionId = text(detail.decisionId);
    const sessionId = text(detail.sessionId);
    const experimentId = text(detail.experimentId, 64);
    const schemaVersion =
      typeof detail.schemaVersion === "number" ? detail.schemaVersion : 1;
    const productId = canonicalProduct(text(detail.productId));
    const heldOriginal =
      schemaVersion === 2 &&
      !decisionId &&
      !experimentId &&
      !text(detail.visitorId) &&
      Boolean(sessionId) &&
      Boolean(productId) &&
      text(detail.arm, 16) === "ORIGINAL" &&
      !text(detail.assignmentArm, 16) &&
      text(detail.reason, 64) === "KILL_SWITCH_ACTIVE";
    if (heldOriginal) {
      // A governed v2 hold supersedes any previously persisted authority. The
      // diagnostic itself is never stored or reused for cart/order linkage.
      latestDecision = null;
      storageTrustedEpoch = -1;
      void queueDecisionClear(epoch);
      return queueSend(event, {
        schemaVersion: 2,
        decisionId: null,
        experimentId: null,
        visitorId: null,
        sessionId,
        productId,
        data: {
          arm: "ORIGINAL",
          assignmentArm: null,
          bucket: null,
          reason: "KILL_SWITCH_ACTIVE",
          persistence: text(detail.persistence, 16),
          experimentVersion: null,
          decisionTimeMs:
            typeof detail.decisionTimeMs === "number"
              ? detail.decisionTimeMs
              : null,
          serverProcessingMs:
            typeof detail.serverProcessingMs === "number"
              ? detail.serverProcessingMs
              : null,
        },
      });
    }
    if (!decisionId || !sessionId || !experimentId) return;
    const decision: DecisionReference = {
      schemaVersion,
      decisionId,
      sessionId,
      experimentId,
      visitorId: text(detail.visitorId),
      productId,
      expiresAt: text(detail.expiresAt),
    };
    const storageReady = deadline(
      queueDecisionWrite(decision, epoch),
      STORAGE_READ_TIMEOUT_MS,
    );
    return queueSend(event, {
      schemaVersion: decision.schemaVersion,
      decisionId,
      experimentId,
      visitorId: decision.visitorId,
      sessionId,
      productId: decision.productId,
      data: {
        arm: text(detail.arm, 16),
        assignmentArm: text(detail.assignmentArm, 16),
        bucket: typeof detail.bucket === "number" ? detail.bucket : null,
        reason: text(detail.reason, 64),
        persistence: text(detail.persistence, 16),
        experimentVersion: typeof detail.experimentVersion === "number" ? detail.experimentVersion : null,
        decisionTimeMs: typeof detail.decisionTimeMs === "number" ? detail.decisionTimeMs : null,
        serverProcessingMs: typeof detail.serverProcessingMs === "number" ? detail.serverProcessingMs : null,
      },
    }, storageReady);
  });

  analytics.subscribe("adaptive_storefront_render", (shopifyEvent) => {
    const event = shopifyEvent as unknown as EventLike;
    const detail = record(event.customData);
    return queueSend(event, {
      decisionId: text(detail.decisionId),
      experimentId: text(detail.experimentId, 64),
      data: {
        status: text(detail.status, 16),
        errorCode: text(detail.errorCode, 64),
      },
    });
  });

  analytics.subscribe("adaptive_storefront_vitals", (shopifyEvent) => {
    const event = shopifyEvent as unknown as EventLike;
    const detail = record(event.customData);
    return queueSend(event, {
      data: {
        lcpMs: typeof detail.lcpMs === "number" ? detail.lcpMs : null,
        clsMilli: typeof detail.clsMilli === "number" ? detail.clsMilli : null,
        inpMs: typeof detail.inpMs === "number" ? detail.inpMs : null,
      },
    });
  });

  analytics.subscribe("page_viewed", (event) => queueSend(event as unknown as EventLike));
  analytics.subscribe("product_viewed", (event) => queueSend(event as unknown as EventLike));
  analytics.subscribe("product_added_to_cart", (event) => queueSend(event as unknown as EventLike));
  analytics.subscribe("cart_viewed", (event) => queueSend(event as unknown as EventLike));
  analytics.subscribe("checkout_started", (shopifyEvent) => {
    const event = shopifyEvent as unknown as EventLike;
    return queueSend(event, checkoutData(event));
  });
  analytics.subscribe("checkout_completed", (shopifyEvent) => {
    const event = shopifyEvent as unknown as EventLike;
    return queueSend(event, checkoutData(event));
  });
});
