export const COMBO_INPUT_CAPABILITIES = ["vision", "pdf", "audioInput", "videoInput"];

export function validateComboCaps(caps) {
  if (caps == null) return null;
  if (typeof caps !== "object" || Array.isArray(caps)) return "Capabilities must be an object";

  const allowed = new Set(["contextWindow", ...COMBO_INPUT_CAPABILITIES]);
  const unknown = Object.keys(caps).find((key) => !allowed.has(key));
  if (unknown) return `Unknown capability: ${unknown}`;

  if ("contextWindow" in caps && (!Number.isSafeInteger(caps.contextWindow) || caps.contextWindow <= 0)) {
    return "Context window must be a positive integer";
  }
  const invalid = COMBO_INPUT_CAPABILITIES.find((key) => key in caps && typeof caps[key] !== "boolean");
  return invalid ? `${invalid} must be a boolean` : null;
}
