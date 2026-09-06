(function adaptiveStorefrontRuntime(root) {
  "use strict";

  var VALID_MODES = ["original", "universal", "matched", "experiment"];
  var VALID_ARMS = ["original", "universal", "matched"];

  function normalizeAngle(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
  }

  function safeContextValue(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 128);
  }

  function resolvePreflightDecision(options) {
    var mode =
      VALID_MODES.indexOf(options.mode) === -1 ? "original" : options.mode;
    var qaArm = VALID_ARMS.indexOf(options.qaArm) === -1
      ? null
      : options.qaArm;

    if (options.allowQaOverride && qaArm === "original") {
      return { arm: "original", policy: null, reason: "qa_override" };
    }
    if (options.allowQaOverride && (qaArm === "matched" || qaArm === "universal")) {
      return { arm: "candidate", policy: qaArm, reason: "qa_override" };
    }
    if (mode === "original") {
      return { arm: "original", policy: null, reason: "configured_original" };
    }
    if (mode !== "experiment") {
      return { arm: "candidate", policy: mode, reason: "configured_" + mode };
    }

    return {
      arm: "candidate",
      policy: "experiment",
      reason: "experiment_server_assignment",
    };
  }

  function randomId(prefix) {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return prefix + "_" + root.crypto.randomUUID();
    }
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  }

  function sessionUnitId(experimentId) {
    var key = "adaptive-storefront:unit:" + String(experimentId || "default");
    try {
      var existing = root.sessionStorage.getItem(key);
      if (existing) return existing;
      var created = randomId("asu");
      root.sessionStorage.setItem(key, created);
      return created;
    } catch (_error) {
      return randomId("asu_ephemeral");
    }
  }

  function persistentUnitId(experimentId) {
    var key = "adaptive-storefront:visitor:" + String(experimentId || "default");
    try {
      var existing = root.localStorage.getItem(key);
      if (existing) return existing;
      var created = randomId("asv");
      root.localStorage.setItem(key, created);
      return created;
    } catch (_error) {
      return null;
    }
  }

  function loadPrivacyState() {
    return new Promise(function resolvePrivacy(resolve) {
      function read() {
        var api = root.Shopify && root.Shopify.customerPrivacy;
        if (!api) return null;
        return {
          analyticsAllowed: api.analyticsProcessingAllowed(),
          preferencesAllowed: api.preferencesProcessingAllowed(),
        };
      }
      var current = read();
      if (current) return resolve(current);
      if (!root.Shopify || typeof root.Shopify.loadFeatures !== "function") {
        return resolve({ analyticsAllowed: true, preferencesAllowed: true });
      }
      var settled = false;
      var finish = function finish(state) {
        if (settled) return;
        settled = true;
        resolve(state);
      };
      root.Shopify.loadFeatures(
        [{ name: "consent-tracking-api", version: "0.1" }],
        function privacyLoaded(error) {
          finish(error ? { analyticsAllowed: false, preferencesAllowed: false } : read() || {
            analyticsAllowed: false,
            preferencesAllowed: false,
          });
        },
      );
      root.setTimeout(function privacyTimeout() {
        finish({ analyticsAllowed: false, preferencesAllowed: false });
      }, 750);
    });
  }

  async function identityContext(experimentId) {
    var privacy = await loadPrivacyState();
    var sessionId = sessionUnitId(experimentId + ":session");
    var visitorId = privacy.analyticsAllowed && privacy.preferencesAllowed
      ? persistentUnitId(experimentId)
      : null;
    return {
      analyticsAllowed: privacy.analyticsAllowed,
      visitorId: visitorId,
      sessionId: sessionId,
      randomizationUnitId: visitorId || sessionId,
      persistence: visitorId ? "visitor" : "session",
      consentState: privacy.analyticsAllowed
        ? privacy.preferencesAllowed
          ? "analytics_and_preferences_allowed"
          : "analytics_allowed"
        : "analytics_denied",
    };
  }

  function safeParameterName(value) {
    var candidate = String(value || "adaptive_angle");
    return /^[a-zA-Z0-9_]{1,64}$/.test(candidate)
      ? candidate
      : "adaptive_angle";
  }

  function safeEndpoint(value) {
    var endpoint = String(value || "/apps/adaptive-storefront").trim();
    return /^\/[a-zA-Z0-9/_-]{1,160}$/.test(endpoint)
      ? endpoint
      : "/apps/adaptive-storefront";
  }

  function isTrue(value) {
    return String(value).toLowerCase() === "true";
  }

  function publish(name, detail) {
    try {
      root.document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (_error) {
      /* Best-effort DOM telemetry. */
    }
    try {
      if (
        root.Shopify &&
        root.Shopify.analytics &&
        typeof root.Shopify.analytics.publish === "function"
      ) {
        var analyticsName = analyticsEventName(name);
        var result = root.Shopify.analytics.publish(analyticsName, detail);
        if (result && typeof result.catch === "function") {
          result.catch(function ignorePublishError() {});
        }
      }
    } catch (_error) {
      /* Best-effort Shopify telemetry. */
    }
  }

  function analyticsEventName(name) {
    return String(name || "").replace("adaptive-storefront:", "adaptive_storefront_");
  }

  function validString(value, maximum) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum;
  }

  function validateRuntimePayload(payload) {
    if (!payload || payload.schemaVersion !== 1) return false;
    if (payload.measurement) {
      var measurement = payload.measurement;
      if (
        !validString(measurement.decisionId, 160) ||
        !validString(measurement.experimentId, 64) ||
        !Number.isInteger(measurement.experimentVersion) ||
        !validString(measurement.assignmentId, 160) ||
        ["original", "matched"].indexOf(measurement.assignmentArm) === -1 ||
        !Number.isInteger(measurement.bucket) ||
        measurement.bucket < 0 ||
        measurement.bucket >= 10000 ||
        ["visitor", "session"].indexOf(measurement.persistence) === -1
      ) return false;
    }
    if (payload.arm === "original") return payload.experience === null;
    if (payload.arm !== "matched" || !payload.experience) return false;
    var experience = payload.experience;
    return (
      validString(payload.acquisitionAngle, 64) &&
      validString(experience.id, 128) &&
      Number.isInteger(experience.version) &&
      experience.version > 0 &&
      validString(experience.contentHash, 128) &&
      validString(experience.headline, 300) &&
      Array.isArray(experience.benefits) &&
      experience.benefits.length >= 3 &&
      experience.benefits.length <= 4 &&
      experience.benefits.every(function validBenefit(benefit) {
        return validString(benefit, 500);
      }) &&
      Array.isArray(experience.proofItems)
    );
  }

  function appendTextElement(parent, tagName, className, text) {
    if (!text) return null;
    var element = root.document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function renderExperience(panel, payload) {
    var experience = payload.experience;
    var article = root.document.createElement("article");
    article.className = "adaptive-panel__content";
    var headingId = "adaptive-heading-" + (panel.dataset.blockId || randomId("block"));
    article.setAttribute("aria-labelledby", headingId);

    appendTextElement(
      article,
      "p",
      "adaptive-panel__eyebrow",
      payload.acquisitionAngle,
    );
    var heading = appendTextElement(
      article,
      "h2",
      "adaptive-panel__heading",
      experience.headline,
    );
    heading.id = headingId;
    appendTextElement(
      article,
      "p",
      "adaptive-panel__supporting-line",
      experience.supportingLine,
    );

    var list = root.document.createElement("ul");
    list.className = "adaptive-panel__benefits";
    experience.benefits.forEach(function appendBenefit(benefit) {
      appendTextElement(list, "li", "", benefit);
    });
    article.appendChild(list);
    experience.proofItems.forEach(function appendProof(proof) {
      appendTextElement(article, "blockquote", "adaptive-panel__proof", proof);
    });
    appendTextElement(
      article,
      "p",
      "adaptive-panel__reassurance",
      experience.reassurance,
    );

    panel.replaceChildren(article);
    panel.hidden = false;
  }

  function requestUrl(panel, parameters, parameterName, policy, identity, experimentId) {
    var url = new URL(safeEndpoint(panel.dataset.runtimeEndpoint), root.location.origin);
    url.searchParams.set("product", String(panel.dataset.productId || ""));
    url.searchParams.set("policy", policy);
    if (policy === "experiment") {
      url.searchParams.set("experiment", experimentId);
      url.searchParams.set("session_id", identity.sessionId);
      url.searchParams.set("persistence", identity.persistence);
      url.searchParams.set("consent", identity.consentState);
      if (identity.visitorId) url.searchParams.set("visitor", identity.visitorId);
    }
    var angle = normalizeAngle(parameters.get(parameterName));
    if (angle) url.searchParams.set("angle", angle);
    ["utm_source", "utm_campaign", "utm_content"].forEach(function addContext(key) {
      var value = safeContextValue(parameters.get(key));
      if (value) url.searchParams.set(key, value);
    });
    return url;
  }

  async function fetchRuntimePayload(panel, parameters, parameterName, policy, identity, experimentId) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = root.setTimeout(function abortSlowRequest() {
      if (controller) controller.abort();
    }, 3000);
    try {
      var response = await root.fetch(
        requestUrl(panel, parameters, parameterName, policy, identity, experimentId).toString(),
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller ? controller.signal : undefined,
        },
      );
      if (!response.ok) {
        var responseError = new Error();
        responseError.adaptiveCode = "http_" + response.status;
        throw responseError;
      }
      var payload = await response.json();
      if (!validateRuntimePayload(payload)) {
        var invalidError = new Error();
        invalidError.adaptiveCode = "invalid_response";
        throw invalidError;
      }
      return payload;
    } finally {
      root.clearTimeout(timeout);
    }
  }

  function attachDecisionToProductForms(decisionId) {
    if (!validString(decisionId, 160)) return;
    Array.prototype.forEach.call(
      root.document.querySelectorAll("form[action*='/cart/add']"),
      function attach(form) {
        var input = form.querySelector("input[data-adaptive-decision-property]");
        if (!input) {
          input = root.document.createElement("input");
          input.type = "hidden";
          input.name = "properties[_adaptive_decision]";
          input.dataset.adaptiveDecisionProperty = "true";
          form.appendChild(input);
        }
        input.value = decisionId;
      },
    );
  }

  function runtimeFailureCode(error) {
    if (error && error.name === "AbortError") return "timeout";
    return error && error.adaptiveCode || "network_error";
  }

  async function initializePanel(panel) {
    if (!panel || panel.dataset.adaptiveInitialized === "true") return;
    panel.dataset.adaptiveInitialized = "true";
    panel.hidden = true;
    if (panel.dataset.mode === "autopilot") return;
    var decisionStartedAt = root.performance && typeof root.performance.now === "function"
      ? root.performance.now()
      : Date.now();
    function decisionTimeMs() {
      var now = root.performance && typeof root.performance.now === "function"
        ? root.performance.now()
        : Date.now();
      return Math.max(0, Math.round(now - decisionStartedAt));
    }

    var experimentId = panel.dataset.experimentId || "technical-proof-v0";
    var parameterName = safeParameterName(panel.dataset.angleParameter);
    var parameters = new URLSearchParams(root.location.search);
    var allowQaOverride =
      isTrue(panel.dataset.allowQaOverrides) ||
      Boolean(root.Shopify && root.Shopify.designMode);
    var identity = await identityContext(experimentId);
    var preflight = resolvePreflightDecision({
      mode: panel.dataset.mode,
      allowQaOverride: allowQaOverride,
      qaArm: normalizeAngle(parameters.get("adaptive_arm")),
    });
    if (panel.dataset.mode === "experiment" && !identity.analyticsAllowed) {
      preflight = { arm: "original", policy: null, reason: "analytics_consent_unavailable" };
    }
    var decisionId = randomId("dec");
    var baseDetails = {
      schemaVersion: 1,
      decisionId: decisionId,
      experimentId: experimentId,
      blockId: panel.dataset.blockId || null,
      productId: panel.dataset.productId || null,
      bucket: Number.isInteger(preflight.bucket) ? preflight.bucket : null,
      persistence: identity.persistence,
      visitorId: identity.visitorId,
      sessionId: identity.sessionId,
      consentState: identity.consentState,
    };

    if (preflight.arm === "original") {
      panel.dataset.adaptiveReason = preflight.reason;
      panel.dataset.adaptiveMeasured = "false";
      publish("adaptive-storefront:decision", Object.assign({}, baseDetails, {
        arm: "original",
        acquisitionAngle: null,
        experienceVersion: null,
        reason: preflight.reason,
        decisionTimeMs: decisionTimeMs(),
      }));
      return;
    }

    try {
      var payload = await fetchRuntimePayload(
        panel,
        parameters,
        parameterName,
        preflight.policy,
        identity,
        experimentId,
      );
      if (preflight.policy === "experiment" && !payload.measurement) {
        var measurementError = new Error();
        measurementError.adaptiveCode = "measurement_missing";
        throw measurementError;
      }
      var measurement = payload.measurement || null;
      if (measurement) {
        decisionId = measurement.decisionId;
        baseDetails.decisionId = measurement.decisionId;
        baseDetails.experimentId = measurement.experimentId;
        baseDetails.experimentVersion = measurement.experimentVersion;
        baseDetails.bucket = measurement.bucket;
        baseDetails.persistence = measurement.persistence;
        baseDetails.serverProcessingMs = measurement.serverProcessingMs;
        attachDecisionToProductForms(measurement.decisionId);
      }
      if (payload.arm === "original") {
        panel.dataset.adaptiveReason = payload.reason;
        panel.dataset.adaptiveMeasured = measurement ? "true" : "false";
        publish("adaptive-storefront:decision", Object.assign({}, baseDetails, {
          arm: measurement ? measurement.assignmentArm : "original",
          acquisitionAngle: null,
          experienceVersion: null,
          reason: payload.reason,
          decisionTimeMs: decisionTimeMs(),
        }));
        return;
      }

      panel.dataset.adaptiveDecisionId = decisionId;
      panel.dataset.adaptiveArm = "matched";
      panel.dataset.adaptiveReason = payload.reason;
      panel.dataset.adaptiveMeasured = measurement ? "true" : "false";
      panel.dataset.adaptiveExperience = payload.acquisitionAngle;
      panel.dataset.adaptiveExperienceVersion = payload.experience.id;
      publish("adaptive-storefront:decision", Object.assign({}, baseDetails, {
        arm: "matched",
        acquisitionAngle: payload.acquisitionAngle,
        experienceVersion: payload.experience.id,
        experienceVersionNumber: payload.experience.version,
        mappingVersion: payload.mappingVersion,
        contentHash: payload.experience.contentHash,
        reason: payload.reason,
        decisionTimeMs: decisionTimeMs(),
      }));
      renderExperience(panel, payload);
      publish("adaptive-storefront:render", {
        schemaVersion: 1,
        decisionId: decisionId,
        experimentId: baseDetails.experimentId,
        arm: "matched",
        experienceVersion: payload.experience.id,
        status: "rendered",
      });
    } catch (error) {
      panel.hidden = true;
      panel.dataset.adaptiveReason = "runtime_failure_safe";
      panel.dataset.adaptiveMeasured = "false";
      panel.dataset.adaptiveFailureCode = runtimeFailureCode(error);
      publish("adaptive-storefront:decision", Object.assign({}, baseDetails, {
        arm: "original",
        acquisitionAngle: null,
        experienceVersion: null,
        reason: "runtime_failure_safe",
        decisionTimeMs: decisionTimeMs(),
      }));
      publish("adaptive-storefront:render", {
        schemaVersion: 1,
        decisionId: decisionId,
        experimentId: baseDetails.experimentId,
        arm: "matched",
        experienceVersion: null,
        status: "failed",
        errorCode: "runtime_unavailable",
      });
    }
  }

  function initializeAll(scope) {
    var rootNode = scope && scope.querySelectorAll ? scope : root.document;
    Array.prototype.forEach.call(
      rootNode.querySelectorAll("[data-adaptive-panel]"),
      function startPanel(panel) {
        initializePanel(panel);
      },
    );
  }

  root.AdaptiveStorefrontDecision = {
    analyticsEventName: analyticsEventName,
    normalizeAngle: normalizeAngle,
    resolvePreflightDecision: resolvePreflightDecision,
    validateRuntimePayload: validateRuntimePayload,
    runtimeFailureCode: runtimeFailureCode,
  };

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", function onReady() {
        initializeAll(root.document);
      });
    } else {
      initializeAll(root.document);
    }
    root.document.addEventListener("shopify:section:load", function onSection(event) {
      initializeAll(event.target);
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
