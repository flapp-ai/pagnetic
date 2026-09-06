(function pagneticAutopilotRuntime(root) {
  "use strict";

  var VISITOR_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var LEASE_MS = 30 * 1000;

  function validString(value, maximum) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum;
  }

  function campaignRefFromLocation(location) {
    try {
      var value = new URL(String(location || ""), "https://shopify.invalid").searchParams.get("pag_campaign");
      return /^[A-Za-z0-9_.:-]{1,128}$/.test(value || "") ? value : null;
    } catch (_error) {
      return null;
    }
  }

  function randomId(prefix) {
    if (root.crypto && typeof root.crypto.randomUUID === "function")
      return prefix + "_" + root.crypto.randomUUID();
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  }

  function safeEndpoint(value) {
    var endpoint = String(value || "/apps/adaptive-storefront").trim();
    return /^\/[a-zA-Z0-9/_-]{1,160}$/.test(endpoint)
      ? endpoint
      : "/apps/adaptive-storefront";
  }

  function publish(name, detail) {
    try {
      root.document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (_error) {
      void _error;
    }
    try {
      var analytics = root.Shopify && root.Shopify.analytics;
      if (analytics && typeof analytics.publish === "function") {
        var result = analytics.publish(
          String(name).replace("adaptive-storefront:", "adaptive_storefront_"),
          detail,
        );
        if (result && typeof result.catch === "function")
          result.catch(function ignorePublishError() {});
      }
    } catch (_error) {
      void _error;
    }
  }

  function privacyState() {
    try {
      var api = root.Shopify && root.Shopify.customerPrivacy;
      if (!api)
        return { status: "unknown", analyticsAllowed: false, preferencesAllowed: false };
      var analyticsAllowed = api.analyticsProcessingAllowed() === true;
      var preferencesAllowed = api.preferencesProcessingAllowed() === true;
      return {
        status: analyticsAllowed && preferencesAllowed ? "allowed" : "denied",
        analyticsAllowed: analyticsAllowed,
        preferencesAllowed: preferencesAllowed,
      };
    } catch (_error) {
      return { status: "unknown", analyticsAllowed: false, preferencesAllowed: false };
    }
  }

  function loadPrivacyState() {
    var current = privacyState();
    if (current.status !== "unknown") return Promise.resolve(current);
    return new Promise(function resolvePrivacy(resolve) {
      if (!root.Shopify || typeof root.Shopify.loadFeatures !== "function") {
        resolve(current);
        return;
      }
      var settled = false;
      function finish(state) {
        if (settled) return;
        settled = true;
        resolve(state);
      }
      root.Shopify.loadFeatures(
        [{ name: "consent-tracking-api", version: "0.1" }],
        function privacyLoaded(error) {
          finish(error ? current : privacyState());
        },
      );
      root.setTimeout(function privacyTimeout() { finish(privacyState()); }, 750);
    });
  }

  function storageScope() {
    return String(root.location && root.location.hostname || "shop").toLowerCase();
  }

  function clearIdentity() {
    try { root.localStorage.removeItem("pagnetic:v2:visitor:" + storageScope()); }
    catch (_error) { void _error; }
    try { root.sessionStorage.removeItem("pagnetic:v2:session:" + storageScope()); }
    catch (_error) { void _error; }
  }

  function visitorToken(now) {
    var key = "pagnetic:v2:visitor:" + storageScope();
    try {
      var parsed = JSON.parse(root.localStorage.getItem(key) || "null");
      if (
        parsed && validString(parsed.token, 160) &&
        Number.isFinite(parsed.createdAt) && Number.isFinite(parsed.expiresAt) &&
        parsed.expiresAt === parsed.createdAt + VISITOR_TTL_MS && now < parsed.expiresAt
      ) return parsed.token;
      var token = randomId("pgv2");
      root.localStorage.setItem(key, JSON.stringify({
        token: token, createdAt: now, expiresAt: now + VISITOR_TTL_MS,
      }));
      return token;
    } catch (_error) {
      return null;
    }
  }

  function sessionId(now) {
    var key = "pagnetic:v2:session:" + storageScope();
    try {
      var parsed = JSON.parse(root.sessionStorage.getItem(key) || "null");
      var value = parsed && validString(parsed.sessionId, 160) &&
        Number.isFinite(parsed.lastSeenAt) && now - parsed.lastSeenAt < SESSION_IDLE_MS
        ? parsed.sessionId : randomId("pgs2");
      root.sessionStorage.setItem(key, JSON.stringify({ sessionId: value, lastSeenAt: now }));
      return value;
    } catch (_error) {
      return null;
    }
  }

  async function identityContext(now) {
    var privacy = await loadPrivacyState();
    if (!privacy.analyticsAllowed || !privacy.preferencesAllowed) {
      clearIdentity();
      return { allowed: false, status: privacy.status, visitorToken: null, sessionId: null };
    }
    var timestamp = Number.isFinite(now) ? now : Date.now();
    var visitor = visitorToken(timestamp);
    var session = sessionId(timestamp);
    if (!visitor || !session) {
      clearIdentity();
      return { allowed: false, status: "storage_unavailable", visitorToken: null, sessionId: null };
    }
    return { allowed: true, status: "allowed", visitorToken: visitor, sessionId: session };
  }

  function validatePayload(payload) {
    if (!payload || payload.schemaVersion !== 2) return false;
    if (["ORIGINAL", "UNIVERSAL", "MATCHED"].indexOf(payload.serving) === -1 ||
        !validString(payload.reason, 80)) return false;
    if (payload.assignmentId && ["ORIGINAL", "MATCHED"].indexOf(payload.assignmentArm) === -1)
      return false;
    if (payload.serving === "ORIGINAL") return payload.content === null;
    var content = payload.content;
    return Boolean(
      content && content.schemaVersion === 2 &&
      validString(content.contentVersionId, 160) &&
      validString(content.contentHash, 128) &&
      validString(content.headline, 160) &&
      Array.isArray(content.headlineEvidenceIds) && content.headlineEvidenceIds.length > 0 &&
      Array.isArray(content.benefits) && content.benefits.length >= 2 && content.benefits.length <= 4 &&
      (content.proofItems == null || (Array.isArray(content.proofItems) && content.proofItems.length <= 4)) &&
      (content.faq == null || (Array.isArray(content.faq) && content.faq.length <= 4)) &&
      content.benefits.every(function validBenefit(benefit) {
        return benefit && validString(benefit.text, 220) &&
          Array.isArray(benefit.evidenceIds) && benefit.evidenceIds.length > 0;
      })
    );
  }

  function appendText(parent, tagName, className, text) {
    if (!text) return null;
    var element = root.document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function render(panel, payload) {
    var content = payload.content;
    var article = root.document.createElement("article");
    article.className = "adaptive-panel__content";
    var headingId = "adaptive-heading-" + (panel.dataset.blockId || randomId("block"));
    article.setAttribute("aria-labelledby", headingId);
    appendText(article, "p", "adaptive-panel__eyebrow", "Product highlights");
    var heading = appendText(article, "h2", "adaptive-panel__heading", content.headline);
    heading.id = headingId;
    var list = root.document.createElement("ul");
    list.className = "adaptive-panel__benefits";
    content.benefits.forEach(function appendBenefit(benefit) {
      appendText(list, "li", "", benefit.text);
    });
    article.appendChild(list);
    (content.proofItems || []).forEach(function appendProof(proof) {
      appendText(article, "p", "adaptive-panel__proof", proof);
    });
    if ((content.faq || []).length) {
      var faq = root.document.createElement("section");
      faq.className = "adaptive-panel__faq";
      appendText(faq, "h3", "adaptive-panel__faq-heading", "Questions");
      content.faq.forEach(function appendFaq(item) {
        var details = root.document.createElement("details");
        details.className = "adaptive-panel__faq-item";
        appendText(details, "summary", "adaptive-panel__faq-question", item.question);
        appendText(details, "p", "adaptive-panel__faq-answer", item.answer);
        faq.appendChild(details);
      });
      article.appendChild(faq);
    }
    if (content.reassurance)
      appendText(article, "p", "adaptive-panel__reassurance", content.reassurance.text);
    panel.replaceChildren(article);
    panel.hidden = false;
  }

  function beginGeneration(panel) {
    if (panel._pa) panel._pa.abort();
    var generation = Number(panel.dataset.pg || "0") + 1;
    panel.dataset.pg = String(generation);
    return generation;
  }

  function generationIsCurrent(panel, generation) {
    return Number(panel.dataset.pg || "0") === generation;
  }

  async function fetchPayload(panel, body, generation) {
    if (privacyState().status !== "allowed") throw codedError("consent_unavailable");
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    panel._pa = controller;
    var timeout = root.setTimeout(function abortSlowRequest() {
      if (controller) controller.abort();
    }, 1500);
    try {
      var endpoint = safeEndpoint(panel.dataset.runtimeEndpoint).replace(/\/$/, "") + "/v2/decision";
      var response = await root.fetch(endpoint, {
        method: "POST", credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) throw codedError("http_" + response.status);
      var payload = await response.json();
      if (!generationIsCurrent(panel, generation)) throw codedError("stale_generation");
      if (privacyState().status !== "allowed") throw codedError("consent_revoked");
      if (!validatePayload(payload)) throw codedError("invalid_response");
      return payload;
    } finally {
      root.clearTimeout(timeout);
      if (panel._pa === controller) panel._pa = null;
    }
  }

  function codedError(code) {
    var error = new Error();
    error.adaptiveCode = code;
    return error;
  }

  function formOwnsProduct(panel, form) {
    if (!form || !form.querySelector) return false;
    var productId = String(panel.dataset.productId || "");
    if (form.dataset && String(form.dataset.productId || "") === productId) return true;
    var variantControl = form.querySelector("[name='id']");
    var variantId = variantControl && String(variantControl.value || "");
    var variantIds = String(panel.dataset.productVariantIds || "").split(",").filter(Boolean);
    return Boolean(variantId && variantIds.indexOf(variantId) !== -1);
  }

  function formScope(panel) {
    return panel.closest && panel.closest(".shopify-section");
  }

  function writeReference(panel, form, reference) {
    var input = form.querySelector("input[data-pagnetic-reference]");
    if (!input) {
      input = root.document.createElement("input");
      input.type = "hidden";
      input.name = "properties[_pagnetic_ref]";
      input.dataset.pr = "true";
      input.dataset.pp = String(panel.dataset.productId || "");
      form.appendChild(input);
    }
    input.value = reference;
  }

  function attachReference(panel, reference) {
    if (!validString(reference, 2000)) return;
    var scope = formScope(panel);
    if (!scope || !scope.querySelectorAll) return;
    panel.dataset.pr = reference;
    Array.prototype.forEach.call(scope.querySelectorAll("form[action*='/cart/add']"), function attach(form) {
      if (formOwnsProduct(panel, form)) writeReference(panel, form, reference);
    });
    if (scope.dataset.ps !== "true" && scope.addEventListener) {
      scope.dataset.ps = "true";
      scope.addEventListener("submit", function attachAtSubmit(event) {
        var current = panel.dataset.pr;
        if (validString(current, 2000) && formOwnsProduct(panel, event.target))
          writeReference(panel, event.target, current);
      }, true);
    }
  }

  function clearReferences(panel) {
    panel.dataset.pr = "";
    var scope = formScope(panel);
    if (!scope || !scope.querySelectorAll) return;
    Array.prototype.forEach.call(scope.querySelectorAll("input[data-pagnetic-reference]"), function clear(input) {
      if (!input.dataset || String(input.dataset.pp || "") === String(panel.dataset.productId || ""))
        input.remove();
    });
  }

  function deactivate(panel, reason, clearStoredIdentity) {
    beginGeneration(panel);
    if (panel._pt) {
      root.clearTimeout(panel._pt);
      panel._pt = null;
    }
    if (panel._pv && root.document)
      root.document.removeEventListener("visibilitychange", panel._pv);
    panel._pv = null;
    panel.dataset.pl = "false";
    clearReferences(panel);
    if (clearStoredIdentity) clearIdentity();
    panel.replaceChildren();
    panel.hidden = true;
    panel.dataset.adaptiveReason = reason;
    panel.dataset.adaptiveMeasured = "false";
  }

  function suspendForLease(panel) {
    clearReferences(panel);
    panel.replaceChildren();
    panel.hidden = true;
    panel.dataset.pl = "checking";
  }

  function installConsentWatcher(panel) {
    if (!root.document || panel.dataset.pc === "true") return;
    panel.dataset.pc = "true";
    root.document.addEventListener("visitorConsentCollected", function consentChanged() {
      if (privacyState().status === "allowed") {
        if (panel.dataset.pi !== "true") initialize(panel);
        return;
      }
      panel.dataset.pi = "false";
      deactivate(panel, "consent_denied", true);
    });
    if (root.addEventListener)
      root.addEventListener("pagehide", function pageHidden() {
        panel.dataset.pi = "false";
        deactivate(panel, "page_unloaded", false);
      }, { once: true });
  }

  function leaseStillValid(initial, current) {
    return current.deploymentRevision === initial.deploymentRevision &&
      (!initial.assignmentId || current.assignmentId === initial.assignmentId) &&
      (initial.serving === "ORIGINAL" || current.serving !== "ORIGINAL");
  }

  function watchLease(panel, body, payload, generation) {
    var checking = false;
    function schedule() {
      if (!generationIsCurrent(panel, generation)) return;
      panel._pt = root.setTimeout(recheck, LEASE_MS);
      panel.dataset.pl = "true";
    }
    async function recheck() {
      if (!generationIsCurrent(panel, generation) || checking) return;
      if (root.document && root.document.hidden) return;
      checking = true;
      suspendForLease(panel);
      try {
        var current = await fetchPayload(panel, body, generation);
        if (!generationIsCurrent(panel, generation)) return;
        if (!leaseStillValid(payload, current)) {
          deactivate(panel, current.reason || "deployment_changed", false);
          return;
        }
        attachReference(panel, current.measurementReference);
        if (current.serving !== "ORIGINAL") render(panel, current);
        panel.dataset.adaptiveReason = current.reason;
        checking = false;
        schedule();
      } catch (error) {
        if (!generationIsCurrent(panel, generation)) return;
        deactivate(panel, "deployment_lease_unavailable", error &&
          (error.adaptiveCode === "consent_unavailable" || error.adaptiveCode === "consent_revoked"));
      }
    }
    schedule();
    if (root.document) {
      panel._pv = function onVisibility() {
        if (!root.document.hidden) recheck();
      };
      root.document.addEventListener("visibilitychange", panel._pv);
    }
  }

  async function initialize(panel) {
    if (!panel || panel.dataset.pi === "true") return;
    var generation = beginGeneration(panel);
    panel.dataset.pi = "true";
    panel.hidden = true;
    installConsentWatcher(panel);
    var identity = await identityContext();
    if (!generationIsCurrent(panel, generation)) return;
    if (!identity.allowed) {
      panel.dataset.adaptiveReason = identity.status === "denied" ? "consent_denied" : "consent_unavailable";
      panel.dataset.adaptiveMeasured = "false";
      panel.dataset.pi = "false";
      return;
    }
    var body = {
      schemaVersion: 2, requestId: randomId("pgr2"),
      productId: String(panel.dataset.productId || ""),
      visitorToken: identity.visitorToken, sessionId: identity.sessionId,
      consent: { analytics: true, preferences: true, policyVersion: "shopify-consent-v1" },
      blockVersion: panel.dataset.blockVersion || "adaptive-panel-v2",
      campaignRef: campaignRefFromLocation(root.location && root.location.href),
    };
    if (!body.campaignRef) delete body.campaignRef;
    try {
      var payload = await fetchPayload(panel, body, generation);
      if (!generationIsCurrent(panel, generation)) return;
      panel.dataset.adaptiveReason = payload.reason;
      panel.dataset.adaptiveDeployment = payload.deploymentId || "";
      panel.dataset.adaptiveDeploymentRevision = String(payload.deploymentRevision || "");
      attachReference(panel, payload.measurementReference);
      panel.dataset.adaptiveMeasured = payload.assignmentId ? "true" : "false";
      publish("adaptive-storefront:decision", {
        schemaVersion: 2, decisionId: payload.decisionId,
        experimentId: payload.experimentId, productId: body.productId,
        sessionId: identity.sessionId, visitorId: null, arm: payload.serving,
        assignmentArm: payload.assignmentArm,
        persistence: "visitor", reason: payload.reason, expiresAt: payload.expiresAt,
      });
      if (payload.serving === "ORIGINAL") {
        if (payload.deploymentId && Number.isInteger(payload.deploymentRevision))
          watchLease(panel, body, payload, generation);
        return;
      }
      if (privacyState().status !== "allowed") {
        deactivate(panel, "consent_revoked", true);
        return;
      }
      render(panel, payload);
      publish("adaptive-storefront:render", {
        schemaVersion: 2, decisionId: payload.decisionId,
        experimentId: payload.experimentId, arm: payload.serving,
        experienceVersion: payload.content.contentVersionId, status: "rendered",
      });
      watchLease(panel, body, payload, generation);
    } catch (error) {
      if (!generationIsCurrent(panel, generation)) return;
      deactivate(panel, "runtime_failure_safe", error &&
        (error.adaptiveCode === "consent_unavailable" || error.adaptiveCode === "consent_revoked"));
      panel.dataset.adaptiveFailureCode = error && error.name === "AbortError"
        ? "timeout" : error && error.adaptiveCode || "network_error";
    }
  }

  function initializeAll(scope) {
    var node = scope && scope.querySelectorAll ? scope : root.document;
    Array.prototype.forEach.call(
      node.querySelectorAll("[data-adaptive-panel][data-mode='autopilot']"),
      initialize,
    );
  }

  root.PagneticAutopilotTest = {
    identityContext: identityContext,
    validatePayload: validatePayload,
    formOwnsProduct: formOwnsProduct,
    attachReference: attachReference,
    clearReferences: clearReferences,
    leaseStillValid: leaseStillValid,
    initialize: initialize,
    deactivate: deactivate,
    watchLease: watchLease,
    campaignRefFromLocation: campaignRefFromLocation,
    render: render,
  };

  if (root.document) {
    if (root.document.readyState === "loading")
      root.document.addEventListener("DOMContentLoaded", function onReady() { initializeAll(root.document); });
    else initializeAll(root.document);
    root.document.addEventListener("shopify:section:load", function onSection(event) {
      initializeAll(event.target);
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
