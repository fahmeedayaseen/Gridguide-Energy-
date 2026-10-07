/**
 * Utility Intelligence Module — Phase 2: Connection Routing Logic
 *
 * Given a resolved utility (a UtilityTerritory row, now extended with
 * connection-method support flags), decide which connection method a
 * homeowner should be routed through, in this priority order:
 *
 *   1. Green Button Connect My Data
 *   2. Arcadia integration
 *   3. Direct utility API
 *   4. Secure login / manual bill upload  (universal fallback)
 *
 * An admin can pin a utility to a specific method via
 * `preferredConnectionMethod`, which always wins over the default order —
 * useful when a given integration is known to be flaky for one utility.
 */

const METHOD_LABEL = {
  GREEN_BUTTON: "Green Button Connect My Data",
  ARCADIA:      "Arcadia",
  UTILITY_API:  "Direct Utility API",
  BILL_UPLOAD:  "Secure Login / Bill Upload",
  MANUAL:       "Manual Entry",
  DERAPI:       "Derapi",
  CSV_UPLOAD:   "CSV Upload",
  BAYOU:        "Bayou",
  TESLA:        "Tesla",
  ENPHASE:      "Enphase",
  SOLAREDGE:    "SolarEdge",
  SPAN:         "Span",
  EMPORIA:      "Emporia",
  SMARTTHINGS:  "SmartThings",
  AMAZON_ALEXA: "Amazon Alexa",
};

/**
 * @param {object|null} utility - a UtilityTerritory row (with the connection
 *   support flags from the Utility Intelligence Module), or null if no
 *   utility could be identified for the homeowner's address.
 * @returns {{ method: string, label: string, reason: string, fallbacks: string[] }}
 */
export function resolveConnectionMethod(utility) {
  if (!utility) {
    return {
      method: "BILL_UPLOAD",
      label: METHOD_LABEL.BILL_UPLOAD,
      reason: "We couldn't identify your utility automatically. Upload a recent bill and we'll extract your usage and rate plan.",
      fallbacks: [],
    };
  }

  if (utility.preferredConnectionMethod) {
    return {
      method: utility.preferredConnectionMethod,
      label: METHOD_LABEL[utility.preferredConnectionMethod] || utility.preferredConnectionMethod,
      reason: `${utility.shortName || utility.name} is configured to use this method by default.`,
      fallbacks: buildFallbacks(utility, utility.preferredConnectionMethod),
    };
  }

  if (utility.supportsGreenButton) {
    return {
      method: "GREEN_BUTTON",
      label: METHOD_LABEL.GREEN_BUTTON,
      reason: `${utility.shortName || utility.name} supports Green Button Connect My Data — the fastest, most reliable way to share your real meter and billing history.`,
      fallbacks: buildFallbacks(utility, "GREEN_BUTTON"),
    };
  }

  if (utility.supportsArcadia) {
    return {
      method: "ARCADIA",
      label: METHOD_LABEL.ARCADIA,
      reason: `${utility.shortName || utility.name} is supported through Arcadia's utility data network.`,
      fallbacks: buildFallbacks(utility, "ARCADIA"),
    };
  }

  if (utility.supportsDirectApi) {
    return {
      method: "UTILITY_API",
      label: METHOD_LABEL.UTILITY_API,
      reason: `${utility.shortName || utility.name} has a direct API integration${utility.directApiProvider ? ` via ${utility.directApiProvider}` : ""}.`,
      fallbacks: buildFallbacks(utility, "UTILITY_API"),
    };
  }

  return {
    method: "BILL_UPLOAD",
    label: METHOD_LABEL.BILL_UPLOAD,
    reason: `${utility.shortName || utility.name} doesn't have an automated data-sharing integration yet — log in to your utility account or upload a recent bill instead.`,
    fallbacks: [],
  };
}

function buildFallbacks(utility, chosen) {
  const order = ["GREEN_BUTTON", "ARCADIA", "UTILITY_API", "BILL_UPLOAD"];
  const supportMap = {
    GREEN_BUTTON: utility.supportsGreenButton,
    ARCADIA:      utility.supportsArcadia,
    UTILITY_API:  utility.supportsDirectApi,
    BILL_UPLOAD:  utility.supportsManualUpload !== false,
  };
  return order.filter((m) => m !== chosen && supportMap[m]);
}

export { METHOD_LABEL };
