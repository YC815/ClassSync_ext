
// background.js — Automation + 固定資料Schema（可換成外部注入）
// Manifest 需：
// "permissions": ["tabs","scripting","storage"]
// "host_permissions": ["https://app.1campus.net/*","https://tschoolkit.web.app/*"]
// "background": { "service_worker": "background.js" }
// "action": { "default_title": "一鍵填寫學習週曆" }
// （可選）"externally_connectable": { "matches": ["https://your-classsync.site/*"] }

const ONECAMPUS = "https://app.1campus.net";
const TSKIT = "https://tschoolkit.web.app";

// ========= 1) 資料 Schema 與預設 DUMMY =========
// 固定 Schema：未來你的 Web APP 就照這個傳
// slots[0] 對應當天第一個 select，slots[1] 對應第二個 select
const DUMMY_PAYLOAD = {
  version: "1.0",
  weekStartISO: "2025-09-22",  // 週一
  days: [
    { dateISO: "2025-09-22", slots: ["吉林基地", "在家中"] },
    { dateISO: "2025-09-23", slots: ["弘道基地", "在家中"] },
    { dateISO: "2025-09-24", slots: ["在家中", "其他地點:實習公司"] }, // 支持自定義地點格式
    { dateISO: "2025-09-25", slots: ["吉林基地", "弘道基地"] },
    { dateISO: "2025-09-26", slots: ["其他地點:圖書館", "在家中"] } // 另一個自定義地點範例
  ],
  // 可選：預期下拉可接受的字串集合，用來校驗/容錯
  placeWhitelist: ["弘道基地", "吉林基地", "在家中", "其他地點"]
};

// ========= 2) 小工具 =========
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 智能等待工具：等待特定元素出現
async function waitForElement(tabId, selector, maxAttempts = 30, interval = 500) {
  console.log(`[ClassSync Wait] 等待元素: ${selector}`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const element = document.querySelector(sel);
          return {
            found: !!element,
            visible: element ? (element.offsetWidth > 0 && element.offsetHeight > 0) : false,
            text: element ? element.textContent?.trim() : null
          };
        },
        args: [selector]
      });

      if (result.found && result.visible) {
        console.log(`[ClassSync Wait] ✅ 元素已出現並可見: ${selector}`);
        return true;
      }

      console.log(`[ClassSync Wait] 嘗試 ${i + 1}/${maxAttempts}: 元素狀態 - 找到: ${result.found}, 可見: ${result.visible}`);
      await sleep(interval);
    } catch (e) {
      console.log(`[ClassSync Wait] 檢查元素時出錯 (嘗試 ${i + 1}): ${e.message}`);
      await sleep(interval);
    }
  }

  console.error(`[ClassSync Wait] ❌ 等待元素超時: ${selector}`);
  return false;
}

// 智能等待工具：等待頁面狀態變化
async function waitForPageStateChange(tabId, checkFunction, maxAttempts = 20, interval = 500) {
  console.log(`[ClassSync Wait] 等待頁面狀態變化...`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: checkFunction,
        args: []
      });

      if (result) {
        console.log(`[ClassSync Wait] ✅ 頁面狀態變化檢測成功`);
        return result;
      }

      console.log(`[ClassSync Wait] 嘗試 ${i + 1}/${maxAttempts}: 狀態尚未變化`);
      await sleep(interval);
    } catch (e) {
      console.log(`[ClassSync Wait] 檢查狀態時出錯 (嘗試 ${i + 1}): ${e.message}`);
      await sleep(interval);
    }
  }

  console.error(`[ClassSync Wait] ❌ 等待狀態變化超時`);
  return false;
}

// 等待 Modal 完全載入並可用
async function waitForModalReady(tabId, maxAttempts = 15, interval = 400) {
  console.log(`[ClassSync Wait] 等待 Modal 完全載入...`);

  const checkModalReady = () => {
    const modal = document.querySelector(".modal-box") || document.querySelector('[role="dialog"], .modal');
    if (!modal) return false;

    // 檢查 Modal 是否可見
    const isVisible = modal.offsetWidth > 0 && modal.offsetHeight > 0;
    if (!isVisible) return false;

    // 檢查是否有日期區塊
    const blocks = modal.querySelectorAll(".p-4.space-y-4");
    if (blocks.length === 0) return false;

    // 檢查是否有 select 元素
    const selects = modal.querySelectorAll("select");
    if (selects.length === 0) return false;

    // 檢查 select 是否已經有選項
    let allSelectsReady = true;
    selects.forEach(select => {
      if (select.options.length <= 1) { // 只有預設選項或沒有選項
        allSelectsReady = false;
      }
    });

    return {
      isReady: allSelectsReady,
      modalFound: true,
      blocksCount: blocks.length,
      selectsCount: selects.length
    };
  };

  return await waitForPageStateChange(tabId, checkModalReady, maxAttempts, interval);
}

async function openOrFocus(urlPrefix) {
  const tabs = await chrome.tabs.query({});
  const exist = tabs.find((t) => t.url && t.url.startsWith(urlPrefix));
  if (exist) {
    await chrome.tabs.update(exist.id, { active: true });
    return exist.id;
  }
  const tab = await chrome.tabs.create({ url: urlPrefix });
  return tab.id;
}

async function execInTab(tabId, func, ...args) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
}

function onTabCompleteOnce(tabId, urlStartsWith, handler, timeoutMs = 30000) {
  console.log(`[ClassSync Monitor] 開始監控分頁 ${tabId} 跳轉到 ${urlStartsWith}`);

  const listener = async (updatedTabId, changeInfo, updatedTab) => {
    if (updatedTabId !== tabId) return;

    // 記錄所有 URL 變化
    if (changeInfo.url) {
      console.log(`[ClassSync Monitor] 分頁 ${tabId} URL 變化: ${changeInfo.url}`);
    }

    if (changeInfo.status === "loading") {
      console.log(`[ClassSync Monitor] 分頁 ${tabId} 開始載入: ${updatedTab.url}`);
    }

    if (changeInfo.status !== "complete") return;

    const url = updatedTab.url || "";
    console.log(`[ClassSync Monitor] 分頁 ${tabId} 載入完成: ${url}`);

    if (!url.startsWith(urlStartsWith)) {
      console.log(`[ClassSync Monitor] URL 不符合預期，繼續等待... (期待: ${urlStartsWith})`);
      return;
    }

    console.log(`[ClassSync Monitor] ✅ 成功跳轉到目標頁面: ${url}`);
    chrome.tabs.onUpdated.removeListener(listener);

    // 清除超時計時器
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    try {
      await handler(updatedTabId);
    } catch (e) {
      console.error(`[ClassSync Monitor] 處理器執行錯誤:`, e);
    }
  };

  // 設置超時機制
  const timeoutId = setTimeout(() => {
    console.error(`[ClassSync Monitor] ❌ 等待跳轉超時 (${timeoutMs}ms)，移除監聽器`);
    chrome.tabs.onUpdated.removeListener(listener);

    // 檢查當前分頁狀態
    chrome.tabs.get(tabId).then(tab => {
      console.log(`[ClassSync Monitor] 超時時的分頁狀態:`, {
        url: tab.url,
        title: tab.title,
        status: tab.status
      });
    }).catch(e => {
      console.error(`[ClassSync Monitor] 無法獲取分頁資訊:`, e);
    });
  }, timeoutMs);

  chrome.tabs.onUpdated.addListener(listener);
}

// ========= 3) 接收／存取 Payload 的管線 =========
let latestPayloadMem = null;

// A) 外部頁面（或 content script 轉發）送進來
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CLASSSYNC_NEXT_WEEK_PAYLOAD") {
    console.log("[ClassSync] 收到外部 payload:", msg.payload);
    if (validatePayload(msg.payload)) {
      console.log("[ClassSync] Payload 驗證通過，儲存並自動執行");
      latestPayloadMem = msg.payload;
      chrome.storage.session.set({ classsync_payload: latestPayloadMem });
      sendResponse?.({ ok: true });
      // 你可以選擇：收到資料就自動開跑
      startFlow().catch(console.error);
    } else {
      console.error("[ClassSync] Payload 驗證失敗:", msg.payload);
      sendResponse?.({ ok: false, error: "Invalid payload schema" });
    }
  }
});

// B) （可選）直接從你的網域使用 onMessageExternal
chrome.runtime.onMessageExternal?.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CLASSSYNC_NEXT_WEEK_PAYLOAD") {
    console.log("[ClassSync] 收到外部網域 payload:", msg.payload);
    if (validatePayload(msg.payload)) {
      console.log("[ClassSync] 外部網域 Payload 驗證通過");
      latestPayloadMem = msg.payload;
      chrome.storage.session.set({ classsync_payload: latestPayloadMem });
      sendResponse?.({ ok: true });
      startFlow().catch(console.error);
    } else {
      console.error("[ClassSync] 外部網域 Payload 驗證失敗:", msg.payload);
      sendResponse?.({ ok: false, error: "Invalid payload schema" });
    }
  }
});

// 取用時的統一接口：記憶體 → session → DUMMY
async function resolvePayload() {
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

  // 沒有外部資料就用 DUMMY
  console.log("[ClassSync] 使用預設 DUMMY payload");
  return DUMMY_PAYLOAD;
}

function validatePayload(p) {
  if (!p || p.version !== "1.0") return false;
  if (!p.weekStartISO || !Array.isArray(p.days) || p.days.length === 0) return false;
  for (const d of p.days) {
    if (!d.dateISO || !Array.isArray(d.slots) || d.slots.length === 0) return false;
  }
  return true;
}

// ========= 4) 會被注入頁面的函式（序列化） =========

// 檢查 1Campus 頁面狀態
function check1CampusPageStatus() {
  console.log("[ClassSync Check] 檢查 1Campus 頁面狀態...");

  const result = {
    url: window.location.href,
    title: document.title,
    isLoginPage: false,
    hasError: false,
    errorMessage: "",
    hasSchoolButton: false,
    hasLearningCalendar: false
  };

  // 檢查是否為登入頁面
  const loginIndicators = [
    'input[type="password"]',
    'form[action*="login"]',
    'button[type="submit"]',
    '.login-form',
    '#login'
  ];

  for (const selector of loginIndicators) {
    if (document.querySelector(selector)) {
      result.isLoginPage = true;
      break;
    }
  }

  // 檢查是否有錯誤訊息（排除常見的 UI 元素）
  const errorSelectors = [
    '.error',
    '.alert-danger',
    '.message.error',
    '.alert-error'
  ];

  for (const selector of errorSelectors) {
    const errorEl = document.querySelector(selector);
    if (errorEl && errorEl.textContent.trim()) {
      const errorText = errorEl.textContent.trim();
      // 排除常見的 UI 控制文字
      if (errorText.length > 2 && !['刪除', '編輯', '新增', '確定', '取消'].includes(errorText)) {
        result.hasError = true;
        result.errorMessage = errorText;
        break;
      }
    }
  }

  // 檢查學校按鈕
  const schoolButton = document.querySelector('button.btn.btn-sm.rounded-full.w-14.btn-ghost');
  result.hasSchoolButton = !!schoolButton;

  // 檢查學習週曆相關元素
  const learningCalendarImg = document.querySelector('img[alt="學習週曆"]');
  const learningCalendarText = Array.from(document.querySelectorAll('*')).find(el =>
    el.textContent?.includes("學習週曆")
  );
  result.hasLearningCalendar = !!(learningCalendarImg || learningCalendarText);

  console.log("[ClassSync Check] 頁面狀態檢查結果:", result);
  return result;
}

// 1Campus：點「學習週曆」卡
function clickLearningCalendarCard() {
  console.log("[ClassSync Click] 開始搜尋「學習週曆」相關元素...");

  // 記錄當前頁面 URL
  console.log("[ClassSync Click] 當前頁面 URL:", window.location.href);

  // 方法 1: 尋找有 alt="學習週曆" 的圖片
  const img = document.querySelector('img[alt="學習週曆"]');
  console.log("[ClassSync Click] 搜尋 img[alt=\"學習週曆\"]:", img ? "找到" : "未找到");

  if (img) {
    console.log("[ClassSync Click] 圖片元素:", {
      src: img.src,
      alt: img.alt,
      parent: img.parentElement?.tagName
    });

    const btn = img.closest('[role="button"],a,button,div[role="link"]');
    console.log("[ClassSync Click] 圖片的可點擊父元素:", btn ? {
      tagName: btn.tagName,
      href: btn.href,
      onclick: btn.onclick ? "有" : "無",
      role: btn.getAttribute('role'),
      classList: Array.from(btn.classList)
    } : "未找到");

    if (btn) {
      console.log("[ClassSync Click] 即將點擊圖片的父元素");
      btn.click();

      // 檢查點擊後的狀態
      setTimeout(() => {
        console.log("[ClassSync Click] 點擊後 URL:", window.location.href);
      }, 100);

      return true;
    }
  }

  // 方法 2: 尋找包含「學習週曆」文字的元素
  console.log("[ClassSync Click] 嘗試方法 2: 搜尋包含「學習週曆」文字的元素");
  const nodes = Array.from(document.querySelectorAll('[role="button"], a, button, div'));
  console.log("[ClassSync Click] 找到", nodes.length, "個可能的按鈕/連結元素");

  const textNodes = nodes.filter(el => (el.textContent || "").trim().includes("學習週曆"));
  console.log("[ClassSync Click] 其中包含「學習週曆」文字的有", textNodes.length, "個");

  textNodes.forEach((node, index) => {
    console.log(`[ClassSync Click] 文字節點 ${index + 1}:`, {
      tagName: node.tagName,
      textContent: node.textContent?.trim(),
      href: node.href,
      onclick: node.onclick ? "有" : "無",
      classList: Array.from(node.classList)
    });
  });

  const hit = textNodes[0];
  if (hit) {
    console.log("[ClassSync Click] 即將點擊文字元素:", hit.tagName);
    hit.click();

    // 檢查點擊後的狀態
    setTimeout(() => {
      console.log("[ClassSync Click] 點擊後 URL:", window.location.href);
    }, 100);

    return true;
  }

  // 方法 3: 更廣泛的搜尋
  console.log("[ClassSync Click] 嘗試方法 3: 廣泛搜尋所有可能相關的元素");
  const allElements = Array.from(document.querySelectorAll('*'));
  const weeklyElements = allElements.filter(el => {
    const text = el.textContent?.toLowerCase() || "";
    return text.includes("學習") || text.includes("週曆") || text.includes("calendar") || text.includes("weekly");
  });

  console.log("[ClassSync Click] 找到可能相關的元素", weeklyElements.length, "個");
  weeklyElements.slice(0, 5).forEach((el, index) => {
    console.log(`[ClassSync Click] 相關元素 ${index + 1}:`, {
      tagName: el.tagName,
      textContent: el.textContent?.trim().substring(0, 50),
      href: el.href,
      classList: Array.from(el.classList).slice(0, 3)
    });
  });

  console.log("[ClassSync Click] ❌ 無法找到「學習週曆」相關的可點擊元素");
  return false;
}

// tschoolkit：點分頁「待填下週」
function clickTabByText(text) {
  const tabs = Array.from(document.querySelectorAll('a.tab, button.tab, [role="tab"]'));
  const t = tabs.find((el) => (el.textContent || "").trim().includes(text));
  if (t) { t.click(); return true; }
  return false;
}

// tschoolkit：點「週曆填報」
function clickWeeklyReportButton() {
  const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const byText = buttons.find((el) => (el.textContent || "").trim().includes("週曆填報"));
  if (byText) { byText.click(); return true; }
  const byClass = document.querySelector('button.btn.btn-sm.btn-neutral, a.btn.btn-sm.btn-neutral');
  if (byClass) { byClass.click(); return true; }
  return false;
}

// tschoolkit（彈窗）：依 payload 填值（支援自定義地點與完整診斷）
async function fillModalByPayload(payload) {
  const PREFIX = "[ClassSync Fill]";
  const log = (...args) => console.log(PREFIX, ...args);
  const warn = (...args) => console.warn(PREFIX, ...args);
  const error = (...args) => console.error(PREFIX, ...args);

  const buildFailure = (reason, details, extra = {}) => {
    return {
      ok: false,
      reason,
      details,
      filledDays: 0,
      totalDays: payload?.days?.length || 0,
      errors: [
        {
          err: reason,
          details,
          ...extra,
        },
      ],
      successRate: 0,
    };
  };

  const normalizeSlot = (slot) => {
    const toTrimmedString = (value) =>
      typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

    if (!slot || (Array.isArray(slot) && slot.length === 0)) {
      return {
        location: "",
        customName: null,
        isCustom: false,
        raw: slot,
      };
    }

    if (typeof slot === "object" && !Array.isArray(slot)) {
      const location = toTrimmedString(slot.location || slot.place || "");
      const customName = toTrimmedString(slot.customName || slot.custom || "");
      const isCustom = Boolean(slot.isCustom ?? location === "其他地點" || customName);
      return {
        location,
        customName: customName || null,
        isCustom,
        raw: slot,
      };
    }

    const rawText = toTrimmedString(slot);
    const delimiterIndex = (() => {
      const standard = rawText.indexOf(":");
      const fullWidth = rawText.indexOf("：");
      if (standard >= 0 && fullWidth >= 0) {
        return Math.min(standard, fullWidth);
      }
      return standard >= 0 ? standard : fullWidth;
    })();

    if (delimiterIndex >= 0) {
      const prefix = rawText.slice(0, delimiterIndex).trim();
      const suffix = rawText.slice(delimiterIndex + 1).trim();
      const isCustom = prefix === "其他地點" || Boolean(suffix);
      return {
        location: prefix || "其他地點",
        customName: suffix || null,
        isCustom,
        raw: slot,
      };
    }

    return {
      location: rawText,
      customName: null,
      isCustom: rawText === "其他地點",
      raw: slot,
    };
  };

  const isElementVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const findModal = () => {
    const selectors = [
      "#next-week-event-modal .modal-box",
      ".modal.modal-open .modal-box",
      ".modal-box",
      "[role=\"dialog\"] .modal-box",
      "[role=\"dialog\"]",
    ];

    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate) {
        if (candidate.classList?.contains("modal-box")) {
          return candidate;
        }
        const nested = candidate.querySelector?.(".modal-box");
        if (nested) return nested;
        return candidate;
      }
    }
    return null;
  };

  const gatherCustomInputsNearSelect = (selectEl) => {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (node) => {
      if (!node) return;
      if (!(node instanceof HTMLElement)) return;
      if (seen.has(node)) return;
      if (node.matches("input,textarea")) {
        const input = node;
        if (
          input.tagName === "INPUT" &&
          (input.type === "" || input.type === "text") &&
          !input.disabled &&
          !input.readOnly &&
          isElementVisible(input)
        ) {
          seen.add(input);
          candidates.push(input);
        }
      }
      if (node !== selectEl && node.querySelector) {
        node.querySelectorAll("input[type=\"text\"],input:not([type])").forEach((child) => {
          if (
            child.tagName === "INPUT" &&
            (child.type === "" || child.type === "text") &&
            !child.disabled &&
            !child.readOnly &&
            isElementVisible(child)
          ) {
            if (!seen.has(child)) {
              seen.add(child);
              candidates.push(child);
            }
          }
        });
      }
    };

    pushCandidate(selectEl.nextElementSibling);
    const container = selectEl.closest(".w-full, .slot-container");
    if (container) pushCandidate(container);
    const block = selectEl.closest(".p-4.space-y-4, [data-day-block]");
    if (block) pushCandidate(block);
    const modal = selectEl.closest(".modal-box") || findModal();
    if (modal) pushCandidate(modal);

    const filtered = candidates.filter((input) => {
      const position = selectEl.compareDocumentPosition(input);
      const isFollowing =
        position & Node.DOCUMENT_POSITION_FOLLOWING ||
        position == Node.DOCUMENT_POSITION_EQUAL;
      return isFollowing;
    });

    const selectRect = selectEl.getBoundingClientRect();
    filtered.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const distanceA = Math.hypot(
        rectA.left + rectA.width / 2 - (selectRect.left + selectRect.width / 2),
        rectA.top + rectA.height / 2 - (selectRect.top + selectRect.height / 2)
      );
      const distanceB = Math.hypot(
        rectB.left + rectB.width / 2 - (selectRect.left + selectRect.width / 2),
        rectB.top + rectB.height / 2 - (selectRect.top + selectRect.height / 2)
      );
      return distanceA - distanceB;
    });

    return filtered;
  };

  const waitForCustomInput = async (selectEl, slotMeta, { maxWait = 2000, interval = 120 } = {}) => {
    const start = performance.now();
    let attempts = 0;
    while (performance.now() - start <= maxWait) {
      const candidates = gatherCustomInputsNearSelect(selectEl);
      if (candidates.length > 0) {
        return { input: candidates[0], attempts };
      }
      await wait(interval);
      attempts += 1;
    }
    warn(
      `時段 ${slotMeta.slotIndex + 1}: 已等待 ${maxWait}ms 仍找不到自定義輸入框`,
      slotMeta
    );
    return { input: null, attempts };
  };

  try {
    log("開始填寫 Modal，payload:", payload);

    if (typeof document === "undefined") {
      error("Document 物件不存在，執行環境異常");
      return buildFailure("no-document", "Document object not available");
    }

    if (!payload || !Array.isArray(payload.days)) {
      error("無效的 payload 格式");
      return buildFailure("invalid-payload", "Invalid payload format", { payload });
    }

    const modal = findModal();
    if (!modal) {
      error("找不到 modal 容器");
      return buildFailure("no-modal", "Modal element not found");
    }

    if (!isElementVisible(modal)) {
      error("Modal 不可見");
      return buildFailure("modal-not-visible", "Modal is not visible");
    }

    log("✅ 找到 modal 容器:", modal);

    const blocks = Array.from(modal.querySelectorAll(".p-4.space-y-4"));
    if (!blocks.length) {
      error("找不到日期區塊");
      return buildFailure("no-day-blocks", "No day blocks found in modal");
    }

    log(`找到 ${blocks.length} 個日期區塊`);

    const blockByDate = new Map();
    blocks.forEach((block, index) => {
      const title = block.querySelector("p.text-xl.text-primary, h3, header");
      const text = (title?.textContent || "").trim();
      const dateText = text.slice(0, 10);
      blockByDate.set(dateText, block);
      log(`區塊 ${index + 1}: ${text} -> ${dateText}`);
    });

    const placeWhitelist = Array.isArray(payload.placeWhitelist) ? payload.placeWhitelist : null;
    const normalizedDays = payload.days.map((day, dayIndex) => ({
      dateISO: day.dateISO,
      dayIndex,
      slots: Array.isArray(day.slots)
        ? day.slots.map((slot, slotIndex) => {
            const normalized = normalizeSlot(slot);
            normalized.dayIndex = dayIndex;
            normalized.slotIndex = slotIndex;
            return normalized;
          })
        : [],
    }));

    const result = {
      ok: true,
      filledDays: 0,
      totalDays: normalizedDays.length,
      errors: [],
      details: [],
      successRate: 0,
    };

    for (const day of normalizedDays) {
      log(`處理日期: ${day.dateISO}, 地點: [${day.slots.map((s) => s.customName ? `${s.location}:${s.customName}` : s.location).join(", ")}]`);

      const block = blockByDate.get(day.dateISO);
      if (!block) {
        const errorEntry = { date: day.dateISO, err: "block-not-found" };
        result.errors.push(errorEntry);
        error(`❌ 找不到日期區塊: ${day.dateISO}`);
        continue;
      }

      const selects = Array.from(block.querySelectorAll("select"));
      log(`日期 ${day.dateISO} 找到 ${selects.length} 個下拉選單`);

      if (!selects.length) {
        const errorEntry = { date: day.dateISO, err: "no-selects" };
        result.errors.push(errorEntry);
        error(`❌ 日期 ${day.dateISO} 找不到下拉選單`);
        continue;
      }

      let dayFilled = true;
      const dayDetails = { date: day.dateISO, slots: [] };

      for (let i = 0; i < Math.min(selects.length, day.slots.length); i++) {
        const selectEl = selects[i];
        const slotInfo = day.slots[i];
        const options = Array.from(selectEl.options || []);
        const slotLabel = slotInfo.customName
          ? `${slotInfo.location}:${slotInfo.customName}`
          : slotInfo.location;

        log(`時段 ${i + 1}: 原始 slot 資料:`, slotInfo.raw);
        log(`時段 ${i + 1}: 標準化後的 slot:`, slotInfo);
        log(
          `時段 ${i + 1}: 可用選項: [${options
            .map((opt) => `"${(opt.value || "").trim()}": "${(opt.textContent || "").trim()}"`)
            .join(", ""))}]`
        );

        if (
          placeWhitelist &&
          slotInfo.location &&
          !slotInfo.isCustom &&
          !placeWhitelist.includes(slotInfo.location)
        ) {
          warn(
            `時段 ${i + 1}: "${slotInfo.location}" 不在允許清單中，仍嘗試匹配`,
            placeWhitelist
          );
        }

        const findMatchingOption = () => {
          const trimmed = (value) => (value == null ? "" : String(value).trim());
          const targetText = trimmed(slotInfo.location);
          let targetOption =
            options.find(
              (opt) =>
                trimmed(opt.value) === targetText || trimmed(opt.textContent) === targetText
            ) || null;

          if (!targetOption && targetText) {
            const lowerTarget = targetText.toLowerCase();
            targetOption =
              options.find((opt) => {
                const text = trimmed(opt.textContent).toLowerCase();
                const value = trimmed(opt.value).toLowerCase();
                return text.includes(lowerTarget) || value.includes(lowerTarget);
              }) || null;
          }

          if (!targetOption && !slotInfo.isCustom) {
            targetOption =
              options.find(
                (opt) =>
                  !opt.disabled &&
                  opt.value &&
                  opt.value !== "none" &&
                  trimmed(opt.textContent) !== ""
              ) || null;
          }

          return targetOption;
        };

        const targetOption = findMatchingOption();
        if (!targetOption) {
          const errorEntry = {
            date: day.dateISO,
            idx: i,
            err: "option-not-found",
            wanted: slotLabel,
            availableOptions: options.map((opt) => opt.textContent?.trim()).filter(Boolean),
          };
          result.errors.push(errorEntry);
          dayDetails.slots.push({
            index: i,
            wanted: slotLabel,
            selected: null,
            value: null,
            success: false,
          });
          error(`❌ 時段 ${i + 1}: 找不到適合的選項給 "${slotLabel}"`);
          dayFilled = false;
          continue;
        }

        const previousValue = selectEl.value;
        targetOption.selected = true;
        selectEl.value = targetOption.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(60);

        let customInputResult = { success: true, value: null };
        if (slotInfo.isCustom) {
          const desiredName = slotInfo.customName || "";
          const { input: customInput, attempts } = await waitForCustomInput(selectEl, slotInfo);
          if (customInput) {
            log(
              `時段 ${i + 1}: 找到自定義輸入框（重試 ${attempts} 次）`,
              customInput
            );
            const nativeSetter =
              Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (nativeSetter) {
              customInput.focus();
              nativeSetter.call(customInput, desiredName);
              customInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
              customInput.dispatchEvent(new Event("change", { bubbles: true }));
              customInput.blur();
              await wait(120);
            } else {
              customInput.value = desiredName;
              customInput.dispatchEvent(new Event("input", { bubbles: true }));
              customInput.dispatchEvent(new Event("change", { bubbles: true }));
            }
            customInputResult.value = customInput.value;
            customInputResult.success = customInput.value.trim() === desiredName.trim();
            log(
              `時段 ${i + 1}: 自定義地點輸入 ${customInputResult.success ? "✅" : "❌"} "${desiredName}" -> "${customInputResult.value}"`
            );
            if (!customInputResult.success) {
              warn(`時段 ${i + 1}: 自定義輸入框未成功設定值`, {
                desiredName,
                actualValue: customInputResult.value,
              });
            }
          } else {
            customInputResult.success = false;
            result.errors.push({
              date: day.dateISO,
              idx: i,
              err: "custom-input-not-found",
              wanted: slotLabel,
            });
          }
        }

        const newValue = selectEl.value;
        const selectSuccess = newValue === targetOption.value;
        const slotSuccess = selectSuccess && customInputResult.success;

        log(
          `時段 ${i + 1}: ${slotSuccess ? "✅" : "❌"} "${slotLabel}" -> "${
            targetOption.textContent?.trim() || targetOption.value
          }" (${previousValue} -> ${newValue})`
        );

        dayDetails.slots.push({
          index: i,
          wanted: slotLabel,
          selected: targetOption.textContent?.trim() || targetOption.value,
          value: targetOption.value,
          oldValue: previousValue,
          newValue,
          customLocationValue: customInputResult.value,
          success: slotSuccess,
        });

        if (!slotSuccess) {
          dayFilled = false;
          result.errors.push({
            date: day.dateISO,
            idx: i,
            err: !selectSuccess ? "set-value-failed" : "custom-location-failed",
            wanted: slotLabel,
            attempted: targetOption.value,
            oldValue: previousValue,
            newValue,
            customValue: customInputResult.value,
          });
        }
      }

      result.details.push(dayDetails);
      if (dayFilled) {
        result.filledDays += 1;
      }
    }

    result.successRate =
      result.totalDays > 0 ? result.filledDays / result.totalDays : 0;
    result.ok = result.errors.length === 0;

    log(
      `填寫完成: ${result.filledDays}/${result.totalDays} 天成功，錯誤數 ${result.errors.length}`
    );
    log("詳細結果:", result);

    return result;
  } catch (err) {
    error("函數執行時發生未預期錯誤:", err);
    return {
      ok: false,
      reason: "unexpected-error",
      details: err?.message || "Unknown error occurred",
      filledDays: 0,
      totalDays: payload?.days?.length || 0,
      errors: [
        {
          err: "unexpected-error",
          details: err?.message || "Unknown error occurred",
          stack: err?.stack,
        },
      ],
      successRate: 0,
    };
  }
}

// tschoolkit（彈窗底部）：點「回報計劃」- 增強版本
function clickReportPlanButton() {
  console.log("[ClassSync Submit] 開始尋找「回報計劃」按鈕");

  const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
  console.log(`[ClassSync Submit] 找到 ${candidates.length} 個按鈕元素`);

  // 先找文字匹配的
  const byText = candidates.find((el) => {
    const text = (el.textContent || "").trim();
    return text.includes("回報計劃") || text.includes("提交") || text.includes("送出");
  });

  if (byText) {
    console.log(`[ClassSync Submit] 找到文字匹配按鈕: "${byText.textContent?.trim()}"`);

    // 檢查按鈕是否可點擊
    if (byText.disabled) {
      console.warn("[ClassSync Submit] ⚠️ 按鈕被禁用");
      return { clicked: false, reason: "button-disabled" };
    }

    byText.click();
    console.log("[ClassSync Submit] ✅ 成功點擊文字匹配按鈕");
    return { clicked: true, method: "by-text", buttonText: byText.textContent?.trim() };
  }

  // 再找樣式匹配的
  const byClass = document.querySelector("button.btn.btn-neutral, a.btn.btn-neutral");
  if (byClass) {
    console.log(`[ClassSync Submit] 找到樣式匹配按鈕: "${byClass.textContent?.trim()}"`);

    if (byClass.disabled) {
      console.warn("[ClassSync Submit] ⚠️ 樣式匹配按鈕被禁用");
      return { clicked: false, reason: "button-disabled" };
    }

    byClass.click();
    console.log("[ClassSync Submit] ✅ 成功點擊樣式匹配按鈕");
    return { clicked: true, method: "by-class", buttonText: byClass.textContent?.trim() };
  }

  console.error("[ClassSync Submit] ❌ 找不到「回報計劃」按鈕");
  console.log("[ClassSync Submit] 可用按鈕:", candidates.map(btn => ({
    text: btn.textContent?.trim(),
    class: Array.from(btn.classList),
    disabled: btn.disabled
  })));

  return { clicked: false, reason: "button-not-found" };
}

// 等待提交成功的確認
async function waitForSubmissionResult(tabId, maxAttempts = 20, interval = 500) {
  console.log("[ClassSync Submit] 等待提交結果確認...");

  const checkSubmissionResult = () => {
    // 檢查可能的成功指示器
    const successIndicators = [
      '.alert-success', '.success', '.message-success',
      '.toast-success', '.notification-success',
      '[class*="success"]', '[data-alert="success"]'
    ];

    const errorIndicators = [
      '.alert-error', '.error', '.message-error',
      '.toast-error', '.notification-error',
      '[class*="error"]', '[data-alert="error"]',
      '.alert-danger', '.danger'
    ];

    // 檢查 Modal 是否已關閉（提交成功的標誌之一）
    const modal = document.querySelector(".modal-box") || document.querySelector('[role="dialog"], .modal');
    const modalClosed = !modal || modal.offsetWidth === 0 || modal.offsetHeight === 0;

    // 檢查成功訊息
    let successMessage = null;
    for (const selector of successIndicators) {
      const element = document.querySelector(selector);
      if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
        successMessage = element.textContent?.trim();
        break;
      }
    }

    // 檢查錯誤訊息
    let errorMessage = null;
    for (const selector of errorIndicators) {
      const element = document.querySelector(selector);
      if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
        errorMessage = element.textContent?.trim();
        break;
      }
    }

    // 檢查 URL 變化（可能的重導向）
    const currentUrl = window.location.href;
    const urlChanged = !currentUrl.includes('/calendar') && !currentUrl.includes('tschoolkit');

    // 檢查頁面內容是否有變化
    const pageTitle = document.title;
    const hasCalendar = !!document.querySelector('[class*="calendar"], [class*="週曆"], .weekly-calendar');

    return {
      success: modalClosed && !errorMessage,
      modalClosed: modalClosed,
      successMessage: successMessage,
      errorMessage: errorMessage,
      urlChanged: urlChanged,
      currentUrl: currentUrl,
      pageTitle: pageTitle,
      hasCalendar: hasCalendar
    };
  };

  return await waitForPageStateChange(tabId, checkSubmissionResult, maxAttempts, interval);
}

// ========= 5) 主流程：使用 payload 自動化 =========
async function startFlow() {
  console.log("[ClassSync] 🚀 開始執行自動化流程");
  const payload = await resolvePayload();
  console.log("[ClassSync] 使用的 payload:", payload);

  // 1) 打開/切到 1Campus
  console.log("[ClassSync] 步驟 1: 打開或切換到 1Campus");
  const tabId = await openOrFocus(ONECAMPUS);
  console.log("[ClassSync] 1Campus 分頁 ID:", tabId);

  // 2) 先檢查頁面狀態
  console.log("[ClassSync] 步驟 2a: 檢查 1Campus 頁面狀態");
  let pageStatus = null;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: check1CampusPageStatus,
      args: []
    });
    pageStatus = result;
    console.log("[ClassSync] 頁面狀態:", pageStatus);

    if (pageStatus.isLoginPage) {
      console.error("[ClassSync] ❌ 檢測到登入頁面，請先手動登入");
      return;
    }

    if (pageStatus.hasError) {
      console.error("[ClassSync] ❌ 頁面有錯誤訊息:", pageStatus.errorMessage);
    }

    if (!pageStatus.hasLearningCalendar) {
      console.warn("[ClassSync] ⚠️ 未檢測到「學習週曆」相關元素");
    }
  } catch (e) {
    console.error("[ClassSync] 檢查頁面狀態失敗:", e);
  }

  // 2b) 點「學習週曆」卡（重試數次以因應 SPA）
  console.log("[ClassSync] 步驟 2b: 尋找並點擊「學習週曆」卡");
  let clicked = false;
  let currentUrl = null;

  // 記錄點擊前的 URL
  try {
    const tab = await chrome.tabs.get(tabId);
    currentUrl = tab.url;
    console.log("[ClassSync] 點擊前的 URL:", currentUrl);
  } catch (e) {
    console.error("[ClassSync] 無法獲取當前 URL:", e);
  }

  for (let i = 0; i < 15; i++) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickLearningCalendarCard,
        args: []
      });

      if (result) {
        clicked = true;
        console.log("[ClassSync] ✅ 成功點擊「學習週曆」卡");

        // 等待一下再檢查是否有 URL 變化
        await sleep(1000);
        const tab = await chrome.tabs.get(tabId);
        if (tab.url !== currentUrl) {
          console.log("[ClassSync] ✅ 檢測到 URL 變化:", tab.url);
        } else {
          console.warn("[ClassSync] ⚠️ 點擊後 URL 未變化，可能需要額外步驟");
        }
        break;
      }
    } catch (e) {
      console.log(`[ClassSync] 嘗試點擊「學習週曆」第 ${i+1} 次失敗:`, e.message);
      await sleep(400);
    }
  }

  if (!clicked) {
    console.error("[ClassSync] ❌ 無法找到或點擊「學習週曆」卡");
    console.log("[ClassSync] 💡 建議：請檢查頁面是否已載入完成，或嘗試手動點擊一次");
  }

  // 3) 監控新分頁的創建（tschoolkit 會在新分頁開啟）
  console.log("[ClassSync] 步驟 3: 監控新分頁創建，等待 tschoolkit...");

  const onTabCreated = async (tab) => {
    console.log(`[ClassSync Monitor] 新分頁被創建: ${tab.url || '(URL未知)'}`);

    // 檢查是否是 tschoolkit 相關的分頁
    if (tab.url && tab.url.startsWith(TSKIT)) {
      console.log(`[ClassSync Monitor] ✅ 檢測到 tschoolkit 新分頁: ${tab.id}`);
      chrome.tabs.onCreated.removeListener(onTabCreated);

      // 等待新分頁載入完成
      const onTabComplete = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId !== tab.id) return;
        if (changeInfo.status !== "complete") return;

        console.log(`[ClassSync Monitor] tschoolkit 分頁載入完成: ${updatedTab.url}`);
        chrome.tabs.onUpdated.removeListener(onTabComplete);

        // 開始執行 tschoolkit 流程
        console.log(`[ClassSync Monitor] 即將執行 tschoolkit 流程...`);
        executeTschoolkitFlow(tab.id).catch(e => {
          console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", e);
        });
      };

      chrome.tabs.onUpdated.addListener(onTabComplete);

      // 如果分頁已經載入完成，直接執行
      if (tab.status === "complete") {
        console.log("[ClassSync Monitor] 分頁已載入完成，直接執行");
        executeTschoolkitFlow(tab.id).catch(e => {
          console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", e);
        });
      }
    } else {
      // 新分頁可能還沒有 URL，我們需要監聽它的 URL 更新
      console.log(`[ClassSync Monitor] 監聽分頁 ${tab.id} 的 URL 更新...`);

      const onTabUpdated = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId !== tab.id) return;

        if (changeInfo.url) {
          console.log(`[ClassSync Monitor] 分頁 ${tab.id} URL 更新為: ${changeInfo.url}`);

          if (changeInfo.url.startsWith(TSKIT)) {
            console.log(`[ClassSync Monitor] ✅ 檢測到 tschoolkit URL: ${tab.id}`);
            chrome.tabs.onCreated.removeListener(onTabCreated);
            chrome.tabs.onUpdated.removeListener(onTabUpdated);

            // 等待頁面載入完成
            const onTschoolkitComplete = (completedTabId, completedChangeInfo, completedTab) => {
              if (completedTabId !== tab.id) return;
              if (completedChangeInfo.status !== "complete") return;

              console.log(`[ClassSync Monitor] tschoolkit 分頁載入完成: ${completedTab.url}`);
              chrome.tabs.onUpdated.removeListener(onTschoolkitComplete);

              console.log(`[ClassSync Monitor] 即將執行 tschoolkit 流程...`);
              executeTschoolkitFlow(tab.id).catch(e => {
                console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", e);
              });
            };

            chrome.tabs.onUpdated.addListener(onTschoolkitComplete);

            // 如果已經載入完成，直接執行
            if (updatedTab.status === "complete") {
              console.log("[ClassSync Monitor] tschoolkit 分頁已載入完成，直接執行");
              executeTschoolkitFlow(tab.id).catch(e => {
                console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", e);
              });
            }
          }
        }
      };

      chrome.tabs.onUpdated.addListener(onTabUpdated);

      // 設置這個監聽器的超時
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
      }, 10000); // 10秒後移除監聽器
    }
  };

  // 監控所有新分頁的創建
  chrome.tabs.onCreated.addListener(onTabCreated);

  // 也檢查是否已經有 tschoolkit 分頁存在
  const existingTabs = await chrome.tabs.query({});
  const existingTschoolkit = existingTabs.find(tab =>
    tab.url && tab.url.startsWith(TSKIT)
  );

  if (existingTschoolkit) {
    console.log(`[ClassSync Monitor] 發現已存在的 tschoolkit 分頁: ${existingTschoolkit.id}`);
    console.log(`[ClassSync Monitor] URL: ${existingTschoolkit.url}`);
    chrome.tabs.onCreated.removeListener(onTabCreated);
    await chrome.tabs.update(existingTschoolkit.id, { active: true });

    // 等待分頁切換完成後執行
    setTimeout(() => {
      console.log(`[ClassSync Monitor] 即將在現有分頁執行 tschoolkit 流程...`);
      executeTschoolkitFlow(existingTschoolkit.id).catch(e => {
        console.error("[ClassSync Monitor] 在現有分頁執行 tschoolkit 流程時發生錯誤:", e);
      });
    }, 1000);
    return;
  }

  // 設置超時機制
  setTimeout(() => {
    console.error("[ClassSync Monitor] ❌ 等待 tschoolkit 新分頁超時 (30秒)");
    chrome.tabs.onCreated.removeListener(onTabCreated);
  }, 30000);
}

// 執行 tschoolkit 網站的自動化流程
async function executeTschoolkitFlow(tabId) {
  try {
    const payload = await resolvePayload();
    console.log(`[ClassSync tschoolkit] 開始在分頁 ${tabId} 執行流程，使用 payload:`, payload);
    console.log("[ClassSync] ✅ 已跳轉到 tschoolkit，分頁 ID:", tabId);

    // 先檢查分頁是否還存在
    try {
      const tab = await chrome.tabs.get(tabId);
      console.log(`[ClassSync tschoolkit] 分頁資訊:`, {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        status: tab.status
      });
    } catch (e) {
      console.error("[ClassSync tschoolkit] 無法獲取分頁資訊:", e);
      return;
    }

  // 4) 等待頁面載入並點「待填下週」
  console.log("[ClassSync] 步驟 4: 等待頁面載入並點擊「待填下週」標籤");

  // 先等待標籤元素出現
  const tabElementReady = await waitForElement(tabId, 'a.tab, button.tab, [role="tab"]', 20, 400);
  if (!tabElementReady) {
    console.error("[ClassSync] ❌ 等待標籤元素出現超時");
    throw new Error("Tab elements not found within timeout");
  }

  let tabClicked = false;
  for (let i = 0; i < 8; i++) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickTabByText,
        args: ["待填下週"]
      });

      if (result) {
        tabClicked = true;
        console.log("[ClassSync] ✅ 成功點擊「待填下週」標籤");

        // 等待標籤切換完成
        await sleep(500);
        break;
      }
    }
    catch (e) {
      console.log(`[ClassSync] 嘗試點擊「待填下週」第 ${i+1} 次失敗:`, e.message);
      await sleep(400);
    }
  }

  if (!tabClicked) {
    console.error("[ClassSync] ❌ 無法找到或點擊「待填下週」標籤");
    throw new Error("Unable to click '待填下週' tab");
  }

  // 5) 等待並點「週曆填報」
  console.log("[ClassSync] 步驟 5: 等待並點擊「週曆填報」按鈕");

  // 等待按鈕元素出現
  const buttonElementReady = await waitForElement(tabId, 'button, a, [role="button"]', 15, 400);
  if (!buttonElementReady) {
    console.error("[ClassSync] ❌ 等待按鈕元素出現超時");
    throw new Error("Button elements not found within timeout");
  }

  let reportClicked = false;
  for (let i = 0; i < 8; i++) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickWeeklyReportButton,
        args: []
      });

      if (result) {
        reportClicked = true;
        console.log("[ClassSync] ✅ 成功點擊「週曆填報」按鈕");
        break;
      }
    }
    catch (e) {
      console.log(`[ClassSync] 嘗試點擊「週曆填報」第 ${i+1} 次失敗:`, e.message);
      await sleep(400);
    }
  }

  if (!reportClicked) {
    console.error("[ClassSync] ❌ 無法找到或點擊「週曆填報」按鈕");
    throw new Error("Unable to click '週曆填報' button");
  }

  // 6) 等待 Modal 完全載入並填寫表單
  console.log("[ClassSync] 步驟 6: 等待 Modal 完全載入並填寫表單...");

  // 使用智能等待確保 Modal 完全準備就緒
  const modalReady = await waitForModalReady(tabId, 15, 500);
  if (!modalReady || !modalReady.isReady) {
    console.error("[ClassSync] ❌ Modal 載入超時或未完全準備就緒:", modalReady);
    throw new Error("Modal not ready within timeout");
  }

  console.log(`[ClassSync] ✅ Modal 準備就緒: ${modalReady.blocksCount} 個日期區塊, ${modalReady.selectsCount} 個下拉選單`);

  let fillResult = null;
  let fillAttempts = 0;
  const maxFillAttempts = 5;

  while (fillAttempts < maxFillAttempts) {
    fillAttempts++;

    try {
      // 預檢查：確認頁面和Modal仍然可用
      console.log(`[ClassSync] 步驟 ${fillAttempts}.1: 執行預檢查`);
      const preCheckResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          try {
            // 檢查基本環境
            if (typeof document === 'undefined') {
              return { ok: false, reason: "no-document" };
            }

            // 檢查 Modal 是否存在且可見
            const modalSelectors = [
              '#next-week-event-modal .modal-box',
              '.modal.modal-open .modal-box',
              '.modal-box',
              '[role="dialog"] .modal-box',
              '[role="dialog"]'
            ];
            let modal = null;
            for (const selector of modalSelectors) {
              const candidate = document.querySelector(selector);
              if (!candidate) continue;
              if (candidate.classList?.contains('modal-box')) {
                modal = candidate;
              } else {
                modal = candidate.querySelector?.('.modal-box') || candidate;
              }
              if (modal) break;
            }

            if (!modal) {
              return { ok: false, reason: 'no-modal' };
            }

            const rect = modal.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
              return { ok: false, reason: 'modal-not-visible' };
            }

            const modalStyle = window.getComputedStyle(modal);
            if (modalStyle.visibility === 'hidden' || modalStyle.display === 'none' || modalStyle.opacity === '0') {
              return { ok: false, reason: 'modal-not-visible' };
            }

            // 檢查日期區塊
            const blocks = Array.from(modal.querySelectorAll(".p-4.space-y-4"));
            if (!blocks.length) {
              return { ok: false, reason: "no-day-blocks" };
            }

            return {
              ok: true,
              modalVisible: true,
              blocksCount: blocks.length,
              modalSize: { width: modal.offsetWidth, height: modal.offsetHeight }
            };
          } catch (error) {
            return { ok: false, reason: "precheck-error", error: error.message };
          }
        },
        world: "MAIN"
      });

      if (!preCheckResult || preCheckResult.length === 0 || !preCheckResult[0].result?.ok) {
        const reason = preCheckResult?.[0]?.result?.reason || "unknown";
        console.error(`[ClassSync] ❌ 預檢查失敗: ${reason}`);
        throw new Error(`Pre-check failed: ${reason}`);
      }

      console.log(`[ClassSync] ✅ 預檢查通過:`, preCheckResult[0].result);

      console.log(`[ClassSync] 步驟 ${fillAttempts}.2: 開始執行腳本注入`);
      const scriptResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: fillModalByPayload,
        args: [payload],
        world: "MAIN"
      });

      console.log(`[ClassSync] 腳本執行原始結果:`, scriptResult);
      console.log(`[ClassSync] 腳本執行結果長度:`, scriptResult?.length);

      if (!scriptResult || scriptResult.length === 0) {
        throw new Error("Script execution returned no results");
      }

      console.log(`[ClassSync] scriptResult[0] 內容:`, scriptResult[0]);
      console.log(`[ClassSync] scriptResult[0].result 內容:`, scriptResult[0]?.result);

      const { result } = scriptResult[0];

      if (!result) {
        console.error(`[ClassSync] ❌ 腳本結果為空，scriptResult[0]:`, scriptResult[0]);
        console.error(`[ClassSync] ❌ scriptResult[0] 的所有鍵:`, Object.keys(scriptResult[0] || {}));
        throw new Error("Script execution returned null/undefined result");
      }

      fillResult = result;
      console.log(`[ClassSync] 填寫嘗試 ${fillAttempts}: 結果 ->`, {
        ok: result.ok,
        filledDays: result.filledDays,
        totalDays: result.totalDays,
        errorCount: result.errors ? result.errors.length : 'undefined',
        successRate: result.successRate
      });

      // 檢查結果的有效性並決定是否繼續
      const hasValidResult = result && typeof result.ok === 'boolean' && typeof result.successRate === 'number';

      if (!hasValidResult) {
        console.error(`[ClassSync] ❌ 無效的填寫結果格式:`, result);
        throw new Error("Invalid fill result format");
      }

      // 如果填寫成功或達到可接受的成功率，則跳出循環
      if (result.ok || result.successRate >= 0.8) {
        console.log(`[ClassSync] ✅ 表單填寫完成，成功率: ${(result.successRate * 100).toFixed(1)}%`);
        break;
      }

      if (fillAttempts < maxFillAttempts) {
        console.log(`[ClassSync] ⚠️ 成功率較低 (${(result.successRate * 100).toFixed(1)}%)，等待後重試...`);
        await sleep(800);
      }

    } catch (e) {
      console.log(`[ClassSync] 填寫嘗試 ${fillAttempts} 失敗:`, e.message);
      if (fillAttempts < maxFillAttempts) {
        await sleep(500);
      }
    }
  }

  if (!fillResult) {
    console.error("[ClassSync] ❌ 所有填寫嘗試都失敗");
    throw new Error("Form filling failed after all attempts");
  }

  if (fillResult && !fillResult.ok && fillResult.successRate < 0.5) {
    console.error(`[ClassSync] ❌ 表單填寫成功率過低: ${(fillResult.successRate * 100).toFixed(1)}%`);
    console.error("[ClassSync] 錯誤詳情:", fillResult.errors);
    console.error("[ClassSync] 完整填寫結果:", JSON.stringify(fillResult, null, 2));

    // 分析每個錯誤的詳細信息
    fillResult.errors.forEach((error, index) => {
      console.error(`[ClassSync] 錯誤 ${index + 1}:`, error);
    });

    throw new Error(`Form filling success rate too low: ${(fillResult.successRate * 100).toFixed(1)}%`);
  }

  if (fillResult) {
    console.log("[ClassSync] 📊 最終填寫結果：", {
      ok: fillResult.ok,
      filledDays: fillResult.filledDays,
      totalDays: fillResult.totalDays,
      successRate: `${(fillResult.successRate * 100).toFixed(1)}%`,
      errorCount: fillResult.errors ? fillResult.errors.length : 0
    });
  }

  // 7) 提交表單並等待確認
  console.log("[ClassSync] 步驟 7: 提交表單並等待確認");

  let submitResult = null;
  let submitAttempts = 0;
  const maxSubmitAttempts = 5;

  while (submitAttempts < maxSubmitAttempts) {
    submitAttempts++;

    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickReportPlanButton,
        args: []
      });

      submitResult = result;
      console.log(`[ClassSync] 提交嘗試 ${submitAttempts}:`, submitResult);

      if (submitResult.clicked) {
        console.log(`[ClassSync] ✅ 成功點擊提交按鈕 (${submitResult.method}): "${submitResult.buttonText}"`);
        break;
      } else {
        console.log(`[ClassSync] ❌ 提交按鈕點擊失敗: ${submitResult.reason}`);
        if (submitAttempts < maxSubmitAttempts) {
          await sleep(500);
        }
      }

    } catch (e) {
      console.log(`[ClassSync] 提交嘗試 ${submitAttempts} 失敗:`, e.message);
      if (submitAttempts < maxSubmitAttempts) {
        await sleep(500);
      }
    }
  }

  if (!submitResult || !submitResult.clicked) {
    console.error("[ClassSync] ❌ 無法點擊提交按鈕");
    throw new Error("Unable to click submit button after all attempts");
  }

  // 8) 等待提交結果確認
  console.log("[ClassSync] 步驟 8: 等待提交結果確認...");

  const submissionResult = await waitForSubmissionResult(tabId, 20, 500);
  if (!submissionResult) {
    console.error("[ClassSync] ❌ 提交結果確認超時");
    throw new Error("Submission result confirmation timeout");
  }

  console.log("[ClassSync] 📊 提交結果:", submissionResult);

  if (submissionResult.success) {
    console.log("[ClassSync] 🎉 表單提交成功！自動化流程完成！");
    if (submissionResult.successMessage) {
      console.log(`[ClassSync] ✅ 成功訊息: "${submissionResult.successMessage}"`);
    }
    if (submissionResult.modalClosed) {
      console.log("[ClassSync] ✅ Modal 已關閉");
    }
  } else if (submissionResult.errorMessage) {
    console.error(`[ClassSync] ❌ 提交失敗: ${submissionResult.errorMessage}`);
    throw new Error(`Submission failed: ${submissionResult.errorMessage}`);
  } else {
    console.warn("[ClassSync] ⚠️ 提交狀態不明確，但流程已完成");
    console.log("[ClassSync] 📋 狀態資訊:", {
      modalClosed: submissionResult.modalClosed,
      url: submissionResult.currentUrl,
      title: submissionResult.pageTitle
    });
  }

  } catch (error) {
    console.error("[ClassSync tschoolkit] 執行流程時發生錯誤:", error.message);
    console.error("[ClassSync tschoolkit] 錯誤堆疊:", error.stack);

    // 根據錯誤類型提供具體的建議
    if (error.message.includes("Tab elements not found")) {
      console.log("[ClassSync tschoolkit] 💡 建議：頁面可能未完全載入，請稍後再試或檢查網路連線");
    } else if (error.message.includes("Modal not ready")) {
      console.log("[ClassSync tschoolkit] 💡 建議：Modal 彈窗載入異常，請檢查頁面是否正常或手動重新操作");
    } else if (error.message.includes("Form filling")) {
      console.log("[ClassSync tschoolkit] 💡 建議：表單填寫問題，可能是選項不匹配或頁面結構變更");
    } else if (error.message.includes("Submission")) {
      console.log("[ClassSync tschoolkit] 💡 建議：提交過程出現問題，請檢查網路連線或手動確認提交狀態");
    }

    // 嘗試獲取當前頁面狀態以便診斷
    try {
      const tab = await chrome.tabs.get(tabId);
      console.log("[ClassSync tschoolkit] 錯誤時的頁面狀態:", {
        url: tab.url,
        title: tab.title,
        status: tab.status
      });
    } catch (tabError) {
      console.error("[ClassSync tschoolkit] 無法獲取錯誤時的頁面狀態:", tabError.message);
    }

    throw error; // 重新拋出錯誤，讓上層處理
  }
}

// 點擴充圖示就跑（若未接到外部 payload，會自動用 DUMMY）
chrome.action.onClicked.addListener(() => {
  console.log("[ClassSync] 📱 擴充功能圖示被點擊，開始執行...");
  startFlow().catch(console.error);
});