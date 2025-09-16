import { DUMMY_PAYLOAD } from "./constants.js";

let latestPayloadMem = null;

export function getCachedPayload() {
  return latestPayloadMem;
}

export async function setCachedPayload(payload) {
  latestPayloadMem = payload;
  await chrome.storage.session.set({ classsync_payload: latestPayloadMem });
}

export async function resolvePayload() {
  console.log("[ClassSync] 開始解析 payload...");
  if (latestPayloadMem) {
    console.log("[ClassSync] 使用記憶體中的 payload");
    return latestPayloadMem;
  }

  const got = await chrome.storage.session.get("classsync_payload");
  if (got?.classsync_payload && validatePayload(got.classsync_payload)) {
    console.log("[ClassSync] 使用 session storage 中的 payload");
    latestPayloadMem = got.classsync_payload;
    return latestPayloadMem;
  }

  console.log("[ClassSync] 使用預設 DUMMY payload");
  return DUMMY_PAYLOAD;
}

export function validatePayload(p) {
  if (!p || p.version !== "1.0") return false;
  if (!p.weekStartISO || !Array.isArray(p.days) || p.days.length === 0) return false;

  for (const d of p.days) {
    if (!d.dateISO || !Array.isArray(d.slots) || d.slots.length === 0) return false;

    for (const slot of d.slots) {
      if (typeof slot === "string") {
        continue;
      } else if (typeof slot === "object" && slot !== null) {
        if (!slot.location || typeof slot.location !== "string") return false;
        if (!slot.customName || typeof slot.customName !== "string") return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

export function normalizeSlot(slot) {
  if (typeof slot === "string") {
    if (slot.includes(":") && slot.startsWith("其他地點:")) {
      const customName = slot.substring(5);
      return {
        location: "其他地點",
        customName: customName.trim(),
        isCustom: true
      };
    }
    return {
      location: slot,
      customName: null,
      isCustom: false
    };
  } else if (
    typeof slot === "object" &&
    slot !== null &&
    slot.location &&
    slot.customName
  ) {
    return {
      location: slot.location,
      customName: slot.customName,
      isCustom: true
    };
  }

  return {
    location: "在家中",
    customName: null,
    isCustom: false
  };
}
