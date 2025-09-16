
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
// 自訂地點使用 { location: "其他地點", customName: "地點名稱" } 格式
const DUMMY_PAYLOAD = {
  version: "1.0",
  weekStartISO: "2025-09-22",  // 週一
  days: [
    { dateISO: "2025-09-22", slots: ["吉林基地", "在家中"] },
    { dateISO: "2025-09-23", slots: ["弘道基地", "在家中"] },
    { dateISO: "2025-09-24", slots: ["在家中", { location: "其他地點", customName: "實習公司" }] },
    { dateISO: "2025-09-25", slots: ["吉林基地", "弘道基地"] },
    { dateISO: "2025-09-26", slots: [{ location: "其他地點", customName: "圖書館" }, "在家中"] }
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

// 智能等待 1Campus 頁面完全載入
async function waitFor1CampusReady(tabId, maxAttempts = 50, interval = 1000) {
  console.log(`[ClassSync Wait] 等待 1Campus 頁面完全載入...`);

  const check1CampusReady = () => {
    // 檢查頁面基本載入狀態
    if (document.readyState !== 'complete') {
      return { ready: false, reason: 'document-not-ready', readyState: document.readyState };
    }

    // 檢查是否有載入指示器（通常SPA會有loading spinner）
    const loadingSelectors = [
      '.loading', '.spinner', '[data-loading]', '.loader',
      '.loading-overlay', '.progress', '.skeleton'
    ];

    for (const selector of loadingSelectors) {
      const loading = document.querySelector(selector);
      if (loading && loading.offsetWidth > 0 && loading.offsetHeight > 0) {
        return { ready: false, reason: 'still-loading', selector: selector };
      }
    }

    // 檢查主要內容區域是否已載入
    const contentSelectors = [
      'main', '.main-content', '.content', '.app-content',
      '[role="main"]', '.container', '.layout'
    ];

    let hasMainContent = false;
    for (const selector of contentSelectors) {
      const content = document.querySelector(selector);
      if (content && content.offsetWidth > 0 && content.offsetHeight > 0) {
        hasMainContent = true;
        break;
      }
    }

    if (!hasMainContent) {
      return { ready: false, reason: 'no-main-content' };
    }

    // 檢查是否有學習週曆相關元素（這是我們的目標）
    const learningCalendarImg = document.querySelector('img[alt="學習週曆"]');
    const learningCalendarText = Array.from(document.querySelectorAll('*')).find(el =>
      el.textContent?.includes("學習週曆")
    );

    // 檢查是否有卡片或按鈕結構（即使還沒有學習週曆）
    const cardSelectors = [
      '.card', '.btn', 'button', '[role="button"]',
      '.item', '.tile', '.panel', 'a[href]'
    ];

    let hasInteractiveElements = false;
    for (const selector of cardSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        hasInteractiveElements = true;
        break;
      }
    }

    // 等待一些互動元素出現，但不強制要求學習週曆
    if (!hasInteractiveElements) {
      return { ready: false, reason: 'no-interactive-elements' };
    }

    // 額外檢查：等待可能的動態內容載入
    const bodyContent = document.body.textContent?.trim();
    if (!bodyContent || bodyContent.length < 100) {
      return { ready: false, reason: 'insufficient-content', contentLength: bodyContent?.length || 0 };
    }

    return {
      ready: true,
      hasLearningCalendar: !!(learningCalendarImg || learningCalendarText),
      hasMainContent: hasMainContent,
      hasInteractiveElements: hasInteractiveElements,
      contentLength: bodyContent.length
    };
  };

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: check1CampusReady,
        args: []
      });

      if (result.ready) {
        console.log(`[ClassSync Wait] ✅ 1Campus 頁面準備就緒:`, result);
        return result;
      }

      console.log(`[ClassSync Wait] 嘗試 ${i + 1}/${maxAttempts}: ${result.reason}`, result);
      await sleep(interval);
    } catch (e) {
      console.log(`[ClassSync Wait] 檢查頁面狀態時出錯 (嘗試 ${i + 1}): ${e.message}`);
      await sleep(interval);
    }
  }

  console.error(`[ClassSync Wait] ❌ 等待 1Campus 頁面準備超時`);
  return { ready: false, reason: 'timeout' };
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

// ========= UI 狀態管理 =========
let uiState = {
  isRunning: false
};

// 向所有 popup 發送狀態更新
function notifyUI(type, data = {}) {
  const message = { type, ...data };
  console.log(`[ClassSync UI] 通知 UI: ${type}`, data);

  // 嘗試發送到所有可能的 popup
  chrome.runtime.sendMessage(message).catch(e => {
    console.log(`[ClassSync UI] UI 通知失敗 (正常，可能沒有打開 popup): ${e.message}`);
  });
}

// A) 外部頁面（或 content script 轉發）送進來
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // 處理 UI 控制訊息
  if (msg?.type === "START_CLASSSYNC") {
    console.log("[ClassSync] 收到 UI 開始執行指令");
    uiState.isRunning = true;
    notifyUI('PROCESS_STARTED');
    startFlow().catch(error => {
      console.error("[ClassSync] 執行流程失敗:", error);
      uiState.isRunning = false;
      notifyUI('PROCESS_ERROR', { error: error.message });
    });
    sendResponse?.({ ok: true });
    return true; // 保持訊息通道開啟
  }

  if (msg?.type === "STOP_CLASSSYNC") {
    console.log("[ClassSync] 收到 UI 停止執行指令");
    uiState.isRunning = false;
    notifyUI('PROCESS_COMPLETED', { success: false });
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg?.type === "PING") {
    console.log("[ClassSync] 收到 UI ping");
    sendResponse?.({ ok: true, isRunning: uiState.isRunning });
    return true;
  }

  if (msg?.type === "CLASSSYNC_NEXT_WEEK_PAYLOAD") {
    console.log("[ClassSync] 收到外部 payload:", msg.payload);
    if (validatePayload(msg.payload)) {
      console.log("[ClassSync] Payload 驗證通過，儲存");
      latestPayloadMem = msg.payload;
      chrome.storage.session.set({ classsync_payload: latestPayloadMem });
      sendResponse?.({ ok: true });
      // 你可以選擇：收到資料就自動開跑
      if (!uiState.isRunning) {
        uiState.isRunning = true;
        notifyUI('PROCESS_STARTED');
        startFlow().catch(error => {
          console.error("[ClassSync] 自動執行失敗:", error);
          uiState.isRunning = false;
          notifyUI('PROCESS_ERROR', { error: error.message });
        });
      }
    } else {
      console.error("[ClassSync] Payload 驗證失敗:", msg.payload);
      sendResponse?.({ ok: false, error: "Invalid payload schema" });
    }
  }

  return true; // 保持訊息通道開啟
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

    // 驗證每個 slot 的格式
    for (const slot of d.slots) {
      if (typeof slot === 'string') {
        // 標準地點或舊格式的自訂地點（向後相容）
        continue;
      } else if (typeof slot === 'object' && slot !== null) {
        // 新格式的自訂地點物件
        if (!slot.location || typeof slot.location !== 'string') return false;
        if (!slot.customName || typeof slot.customName !== 'string') return false;
      } else {
        // 無效格式
        return false;
      }
    }
  }
  return true;
}

// 標準化 slot 格式：將各種格式統一轉換為處理函數能理解的格式
function normalizeSlot(slot) {
  if (typeof slot === 'string') {
    // 處理舊格式的自訂地點："其他地點:地點名稱"
    if (slot.includes(':') && slot.startsWith('其他地點:')) {
      const customName = slot.substring(5); // 移除 "其他地點:" 前綴（5個字符）
      return {
        location: "其他地點",
        customName: customName.trim(),
        isCustom: true
      };
    }
    // 標準地點
    return {
      location: slot,
      customName: null,
      isCustom: false
    };
  } else if (typeof slot === 'object' && slot !== null && slot.location && slot.customName) {
    // 新格式的自訂地點物件
    return {
      location: slot.location,
      customName: slot.customName,
      isCustom: true
    };
  }

  // 無效格式，返回預設值
  return {
    location: "在家中",
    customName: null,
    isCustom: false
  };
}

// ========= 4) 自訂地點處理函式 =========

// 更穩健的可編輯判斷
function isEditable(el) {
  if (!el) return false;
  const cs = window.getComputedStyle(el);
  const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  const enabled = !el.disabled && !el.readOnly && !el.hasAttribute('aria-disabled');
  return visible && enabled;
}

// 以 MutationObserver + 兩次 rAF 等待「真的可編輯」
function waitUntilEditable(targetEl, { timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    if (isEditable(targetEl)) return resolve(true);

    let done = false;
    const stop = () => { if (!done) { done = true; obs.disconnect(); clearTimeout(tid); } };

    const obs = new MutationObserver(async () => {
      // 多等兩個 animation frame，確保 layout 與樣式完成
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (isEditable(targetEl)) { stop(); resolve(true); }
    });

    obs.observe(document.documentElement, { attributes: true, childList: true, subtree: true });

    const tid = setTimeout(() => { stop(); resolve(false); }, timeout);
  });
}

// 修復後的自定義地點填寫相關函數

// 比原本「寬高>0」更穩定：看 computedStyle 與禁用態
function isInputReady(input) {
  if (!input) return false;
  const cs = getComputedStyle(input);
  const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  return visible && !input.disabled && !input.readOnly;
}

// 用原生 setter 寫值，解決 React/受控輸入不同步
function setNativeInputValue(input, value) {
  // 使用 HTMLInputElement.prototype.value setter 確保跳過任何框架攔截
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    // 理論上不會走到這，但保底
    input.value = value;
  }

  // 對受控元件，input 事件是關鍵
  input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

// 等待/取得該 slot 的自訂輸入框：優先用 MutationObserver，退而求其次輪詢
function getOrWaitCustomInput(container, select, maxWaitMs = 3000) {
  return new Promise((resolve) => {
    // 先查一次
    const q = () => container?.querySelector('input[type="text"], input[placeholder*="地點"], input[placeholder*="名稱"], input.input');
    let found = q();
    if (found) return resolve(found);

    // 確保 select 已是「其他地點」
    if (select && select.value !== '其他地點') {
      select.value = '其他地點';
      select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }

    // 用 MutationObserver 等待輸入框出現
    const obs = new MutationObserver(() => {
      const el = q();
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    if (container) {
      obs.observe(container, { childList: true, subtree: true });
    }

    // 兜底 timeout
    setTimeout(() => {
      obs.disconnect();
      resolve(q() || null);
    }, maxWaitMs);
  });
}

async function fillCustomLocation(container, customName, slotIndex) {
  console.log(`測試填寫自訂地點: 時段 ${slotIndex + 1}, 地點: "${customName}"`);
  try {
    const select = container?.querySelector('select');

    // 確保「其他地點」已選
    if (select && select.value !== '其他地點') {
      select.value = '其他地點';
      select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }

    // 取得或等待 input
    const input = await getOrWaitCustomInput(container, select, 3000);

    if (!input) {
      console.error(`時段 ${slotIndex + 1}: 找不到輸入框`);
      return { success: false, reason: 'no-input', customLocationValue: null };
    }

    // 有些站點會短暫設為 readonly/disabled，這裡強制解除一次
    input.disabled = false;
    input.readOnly = false;

    // 滾到可見（避免某些框架對不可見元素忽略事件）
    input.scrollIntoView?.({ block: 'center', inline: 'nearest' });

    // 就算 isInputReady 回 false，也先試著填 — 很多時候其實能寫
    input.focus();
    setNativeInputValue(input, customName);
    input.blur();

    // 驗證
    const ok = input.value === customName;
    console.log(`時段 ${slotIndex + 1}: 自訂地點填寫 ${ok ? '✅' : '❌'} "${customName}" -> "${input.value}"`);
    return { success: ok, reason: ok ? 'filled' : 'value-mismatch', customLocationValue: input.value };
  } catch (err) {
    console.error(`時段 ${slotIndex + 1}: 填寫時發生錯誤:`, err);
    return { success: false, reason: 'fill-error', customLocationValue: null, error: err?.message };
  }
}


// ========= 5) 錯誤處理與分類 =========

// 將技術錯誤轉換為用戶友善的訊息
function categorizeError(error) {
  const message = error.message || error.toString();
  const messageLower = message.toLowerCase();

  let category = 'unknown';
  let userMessage = '發生未知錯誤，請重試';
  let suggestions = [];

  if (messageLower.includes('login') || messageLower.includes('登入')) {
    category = 'authentication';
    userMessage = '需要登入 1Campus';
    suggestions = ['請先登入 1Campus', '確認登入狀態正常'];
  }
  else if (messageLower.includes('page') || messageLower.includes('載入') || messageLower.includes('ready')) {
    category = 'page_load';
    userMessage = '頁面載入失敗';
    suggestions = ['重新整理頁面', '檢查網路連線', '稍後重試'];
  }
  else if (messageLower.includes('click') || messageLower.includes('學習週曆') || messageLower.includes('element')) {
    category = 'element_not_found';
    userMessage = '找不到學習週曆按鈕';
    suggestions = ['確認頁面已完全載入', '檢查是否在正確的頁面', '嘗試手動點擊一次'];
  }
  else if (messageLower.includes('tschoolkit') || messageLower.includes('新分頁') || messageLower.includes('tab')) {
    category = 'tab_navigation';
    userMessage = 'tschoolkit 頁面開啟失敗';
    suggestions = ['檢查網路連線', '確認 tschoolkit 網站可正常訪問', '關閉其他不必要的分頁'];
  }
  else if (messageLower.includes('modal') || messageLower.includes('form') || messageLower.includes('表單')) {
    category = 'form_access';
    userMessage = '無法開啟週曆填報表單';
    suggestions = ['手動點擊「週曆填報」按鈕', '確認頁面沒有彈出視窗阻擋', '重新載入 tschoolkit 頁面'];
  }
  else if (messageLower.includes('fill') || messageLower.includes('填寫') || messageLower.includes('custom') || messageLower.includes('自訂')) {
    category = 'form_filling';
    userMessage = '表單填寫失敗';
    suggestions = ['檢查週曆資料格式', '確認所有必填欄位都有資料', '手動檢查並完成填寫'];
  }
  else if (messageLower.includes('submit') || messageLower.includes('提交') || messageLower.includes('送出')) {
    category = 'submission';
    userMessage = '提交失敗';
    suggestions = ['檢查網路連線', '確認表單資料完整', '嘗試手動提交'];
  }
  else if (messageLower.includes('timeout') || messageLower.includes('超時')) {
    category = 'timeout';
    userMessage = '操作超時';
    suggestions = ['檢查網路連線速度', '關閉其他耗費資源的程式', '稍後重試'];
  }

  return {
    category,
    userMessage,
    suggestions,
    originalError: message,
    timestamp: new Date().toISOString()
  };
}

// ========= 6) 會被注入頁面的函式（序列化） =========

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

// 1Campus：智能搜尋並點擊「學習週曆」卡
function clickLearningCalendarCard() {
  console.log("[ClassSync Click] 開始智能搜尋「學習週曆」相關元素...");

  // 記錄當前頁面URL和基本狀態
  console.log("[ClassSync Click] 當前頁面URL:", window.location.href);
  console.log("[ClassSync Click] 頁面載入狀態:", document.readyState);

  // 等待DOM穩定（防止元素還在動態載入）
  const startTime = Date.now();

  // 優先級搜尋策略
  const searchStrategies = [
    // 策略1: 精確匹配圖片alt屬性
    () => {
      const img = document.querySelector('img[alt="學習週曆"]');
      if (img) {
        const clickable = img.closest('[role="button"], a, button, div[onclick], [data-click], .clickable, .card, .item, .tile');
        if (clickable && clickable.offsetWidth > 0 && clickable.offsetHeight > 0) {
          console.log("[ClassSync Click] ✅ 策略1成功: 找到學習週曆圖片的可點擊父元素");
          return clickable;
        }
        // 如果父元素不可點擊，嘗試點擊圖片本身
        if (img.offsetWidth > 0 && img.offsetHeight > 0) {
          console.log("[ClassSync Click] ✅ 策略1備用: 直接點擊學習週曆圖片");
          return img;
        }
      }
      return null;
    },

    // 策略2: 文字內容精確匹配
    () => {
      const textElements = Array.from(document.querySelectorAll('a, button, [role="button"], div, span'));
      const exactMatch = textElements.find(el => {
        const text = (el.textContent || "").trim();
        return text === "學習週曆" && el.offsetWidth > 0 && el.offsetHeight > 0;
      });
      if (exactMatch) {
        console.log("[ClassSync Click] ✅ 策略2成功: 找到精確文字匹配的元素");
        return exactMatch;
      }
      return null;
    },

    // 策略3: 文字內容包含匹配
    () => {
      const clickableElements = Array.from(document.querySelectorAll(
        'a, button, [role="button"], div[onclick], [data-click], .card, .item, .tile, .btn, .clickable'
      ));
      const textMatch = clickableElements.find(el => {
        const text = (el.textContent || "").trim();
        return text.includes("學習週曆") && el.offsetWidth > 0 && el.offsetHeight > 0;
      });
      if (textMatch) {
        console.log("[ClassSync Click] ✅ 策略3成功: 找到包含學習週曆文字的可點擊元素");
        return textMatch;
      }
      return null;
    },

    // 策略4: 部分文字匹配（學習、週曆）
    () => {
      const clickableElements = Array.from(document.querySelectorAll(
        'a, button, [role="button"], div[onclick], [data-click], .card, .item, .tile, .btn'
      ));
      const partialMatch = clickableElements.find(el => {
        const text = (el.textContent || "").trim().toLowerCase();
        return (text.includes("學習") || text.includes("週曆") || text.includes("calendar"))
               && el.offsetWidth > 0 && el.offsetHeight > 0;
      });
      if (partialMatch) {
        console.log("[ClassSync Click] ✅ 策略4成功: 找到部分匹配的元素");
        return partialMatch;
      }
      return null;
    },

    // 策略5: 深度搜尋所有可能的學習相關元素
    () => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const candidates = allElements.filter(el => {
        const text = (el.textContent || "").toLowerCase();
        const hasKeywords = text.includes("學習") || text.includes("週曆") ||
                           text.includes("calendar") || text.includes("learning");
        const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
        const isClickable = el.tagName === 'A' || el.tagName === 'BUTTON' ||
                           el.getAttribute('role') === 'button' ||
                           el.onclick || el.getAttribute('data-click') ||
                           el.classList.contains('clickable') ||
                           el.classList.contains('card') ||
                           el.classList.contains('btn');
        return hasKeywords && isVisible && isClickable;
      });

      // 優先選擇最可能的候選
      const bestCandidate = candidates.find(el => {
        const text = (el.textContent || "").toLowerCase();
        return text.includes("學習") && text.includes("週曆");
      }) || candidates[0];

      if (bestCandidate) {
        console.log("[ClassSync Click] ✅ 策略5成功: 深度搜尋找到候選元素");
        return bestCandidate;
      }
      return null;
    }
  ];

  // 依序嘗試各種策略
  for (let i = 0; i < searchStrategies.length; i++) {
    try {
      const element = searchStrategies[i]();
      if (element) {
        console.log(`[ClassSync Click] 使用策略${i + 1}找到目標元素:`, {
          tagName: element.tagName,
          textContent: element.textContent?.trim().substring(0, 100),
          classList: Array.from(element.classList).slice(0, 5),
          href: element.href,
          onclick: !!element.onclick
        });

        // 嘗試點擊
        try {
          element.click();
          console.log(`[ClassSync Click] ✅ 成功點擊元素 (策略${i + 1})`);

          // 檢查點擊效果
          setTimeout(() => {
            console.log("[ClassSync Click] 點擊後URL:", window.location.href);
          }, 200);

          return true;
        } catch (clickError) {
          console.warn(`[ClassSync Click] ⚠️ 策略${i + 1}點擊失敗:`, clickError.message);
          continue;
        }
      }
    } catch (strategyError) {
      console.warn(`[ClassSync Click] ⚠️ 策略${i + 1}執行失敗:`, strategyError.message);
      continue;
    }
  }

  // 如果所有策略都失敗，提供詳細的診斷資訊
  console.error("[ClassSync Click] ❌ 所有搜尋策略都失敗");

  // 診斷資訊
  const diagnostics = {
    totalElements: document.querySelectorAll('*').length,
    buttons: document.querySelectorAll('button').length,
    links: document.querySelectorAll('a').length,
    clickableElements: document.querySelectorAll('[role="button"], [onclick], [data-click]').length,
    imagesWithAlt: document.querySelectorAll('img[alt]').length,
    hasLearningText: !!Array.from(document.querySelectorAll('*')).find(el =>
      el.textContent?.includes("學習")
    ),
    hasCalendarText: !!Array.from(document.querySelectorAll('*')).find(el =>
      el.textContent?.includes("週曆")
    ),
    searchTime: Date.now() - startTime
  };

  console.log("[ClassSync Click] 診斷資訊:", diagnostics);

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

// ========= 三輪式填寫架構 =========

// 第一輪：分析所有下拉選單的可用選項
async function analyzeModalOptions(modal, payload) {
  console.log("[ClassSync Phase1] 開始分析下拉選單選項");

  const result = {
    blockByDate: new Map(),
    optionsBySlot: new Map(), // key: "dateISO:slotIndex", value: { select, options, needsCustom }
    errors: []
  };

  // 建立日期對應表
  const blocks = Array.from(modal.querySelectorAll(".p-4.space-y-4"));
  console.log(`[ClassSync Phase1] 找到 ${blocks.length} 個日期區塊`);

  blocks.forEach((block, index) => {
    const title = block.querySelector("p.text-xl.text-primary");
    const txt = (title?.textContent || "").trim();
    const dateStr = txt.slice(0, 10);
    result.blockByDate.set(dateStr, block);
    console.log(`[ClassSync Phase1] 區塊 ${index + 1}: ${txt} -> ${dateStr}`);
  });

  // 分析每日的選項
  for (const day of payload.days) {
    const block = result.blockByDate.get(day.dateISO);
    if (!block) {
      result.errors.push({ date: day.dateISO, phase: "analyze", err: "block-not-found" });
      continue;
    }

    const selects = Array.from(block.querySelectorAll("select"));
    console.log(`[ClassSync Phase1] 日期 ${day.dateISO} 找到 ${selects.length} 個下拉選單`);

    selects.forEach((select, slotIndex) => {
      const slotKey = `${day.dateISO}:${slotIndex}`;
      const options = Array.from(select.options || []);
      const normalizedSlot = normalizeSlot(day.slots[slotIndex]);

      // 判斷是否需要自定義地點
      const needsCustom = normalizedSlot && normalizedSlot.isCustom;

      result.optionsBySlot.set(slotKey, {
        select,
        options,
        normalizedSlot,
        needsCustom,
        targetLocation: normalizedSlot?.location || day.slots[slotIndex]
      });

      console.log(`[ClassSync Phase1] ${slotKey}: 目標="${normalizedSlot?.location || day.slots[slotIndex]}", 需要自定義=${needsCustom}`);
    });
  }

  console.log(`[ClassSync Phase1] 完成分析，共 ${result.optionsBySlot.size} 個時段`);
  return result;
}

// 第二輪：收集需要的輸入框
async function collectCustomInputs(analysisResult) {
  console.log("[ClassSync Phase2] 開始收集自定義地點輸入框");

  const inputsBySlot = new Map(); // key: "dateISO:slotIndex", value: input element
  const errors = [];

  // 先設定所有需要「其他地點」的下拉選單
  for (const [slotKey, slotInfo] of analysisResult.optionsBySlot) {
    if (!slotInfo.needsCustom) continue;

    const { select } = slotInfo;
    console.log(`[ClassSync Phase2] 設定 ${slotKey} 為「其他地點」`);

    // 設定為「其他地點」
    if (select.value !== '其他地點') {
      select.value = '其他地點';
      select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
  }

  // 等待一下讓 DOM 更新
  await new Promise(r => setTimeout(r, 200));

  // 收集所有輸入框
  for (const [slotKey, slotInfo] of analysisResult.optionsBySlot) {
    if (!slotInfo.needsCustom) continue;

    const container = slotInfo.select.closest('.w-full');
    try {
      const input = await getOrWaitCustomInput(container, slotInfo.select, 3000);
      if (input) {
        inputsBySlot.set(slotKey, input);
        console.log(`[ClassSync Phase2] ✅ ${slotKey} 找到輸入框`);
      } else {
        errors.push({ slotKey, phase: "collect", err: "input-not-found" });
        console.log(`[ClassSync Phase2] ❌ ${slotKey} 找不到輸入框`);
      }
    } catch (err) {
      errors.push({ slotKey, phase: "collect", err: "input-error", details: err.message });
      console.log(`[ClassSync Phase2] ❌ ${slotKey} 輸入框收集錯誤:`, err);
    }
  }

  console.log(`[ClassSync Phase2] 完成收集，共 ${inputsBySlot.size} 個輸入框`);
  return { inputsBySlot, errors };
}

// 第三輪：批次填寫所有資料
async function fillAllData(analysisResult, inputsResult) {
  console.log("[ClassSync Phase3] 開始批次填寫資料");

  const result = {
    filledSlots: 0,
    totalSlots: analysisResult.optionsBySlot.size,
    errors: [...analysisResult.errors, ...inputsResult.errors],
    details: []
  };

  for (const [slotKey, slotInfo] of analysisResult.optionsBySlot) {
    const [dateISO, slotIndex] = slotKey.split(':');
    const slotIndexNum = parseInt(slotIndex);

    try {
      if (slotInfo.needsCustom) {
        // 處理自定義地點
        const input = inputsResult.inputsBySlot.get(slotKey);
        if (!input) {
          result.errors.push({ slotKey, phase: "fill", err: "no-input-available" });
          continue;
        }

        const customResult = await fillCustomLocationDirect(input, slotInfo.normalizedSlot.customName, slotIndexNum);

        result.details.push({
          slotKey,
          type: "custom",
          wanted: slotInfo.normalizedSlot.customName,
          success: customResult.success,
          value: customResult.customLocationValue
        });

        if (customResult.success) {
          result.filledSlots++;
        } else {
          result.errors.push({ slotKey, phase: "fill", err: "custom-fill-failed", details: customResult });
        }

      } else {
        // 處理一般地點
        const { select, options, targetLocation } = slotInfo;

        // 尋找匹配的選項
        let target = options.find(o =>
          ((o.value || "").trim() === targetLocation) ||
          ((o.textContent || "").trim() === targetLocation)
        );

        if (!target) {
          // 嘗試模糊匹配
          target = options.find(o => {
            const optText = (o.textContent || "").trim();
            return optText.includes(targetLocation) || targetLocation.includes(optText);
          });
        }

        if (!target) {
          // 使用第一個有效選項
          target = options.find(o =>
            !o.disabled &&
            o.value &&
            o.value !== "none" &&
            o.value !== "" &&
            (o.textContent || "").trim() !== ""
          );
        }

        if (target) {
          select.value = target.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));

          const success = select.value === target.value;

          result.details.push({
            slotKey,
            type: "standard",
            wanted: targetLocation,
            selected: target.textContent?.trim(),
            value: target.value,
            success
          });

          if (success) {
            result.filledSlots++;
          } else {
            result.errors.push({ slotKey, phase: "fill", err: "select-failed" });
          }

          console.log(`[ClassSync Phase3] ${slotKey}: ${success ? '✅' : '❌'} ${targetLocation} -> ${target.textContent?.trim()}`);
        } else {
          result.errors.push({
            slotKey,
            phase: "fill",
            err: "no-suitable-option",
            availableOptions: options.map(o => o.textContent?.trim()).filter(Boolean)
          });

          result.details.push({
            slotKey,
            type: "standard",
            wanted: targetLocation,
            selected: null,
            success: false
          });
        }
      }
    } catch (err) {
      result.errors.push({ slotKey, phase: "fill", err: "unexpected-error", details: err.message });
    }
  }

  console.log(`[ClassSync Phase3] 完成填寫，成功 ${result.filledSlots}/${result.totalSlots} 個時段`);
  return result;
}

// 直接填寫自定義地點輸入框（不再查找輸入框）
async function fillCustomLocationDirect(input, customName, slotIndex) {
  console.log(`[ClassSync Fill] 直接填寫自定義地點: 時段 ${slotIndex + 1}, 地點: "${customName}"`);

  try {
    if (!input || !isInputReady(input)) {
      return { success: false, reason: 'input-not-ready', customLocationValue: null };
    }

    // 強制解除禁用狀態
    input.disabled = false;
    input.readOnly = false;

    // 使用修復後的填寫方法
    input.focus();
    setNativeInputValue(input, customName);
    input.blur();

    // 驗證結果
    const ok = input.value === customName;
    console.log(`[ClassSync Fill] 自定義地點填寫 ${ok ? '成功' : '失敗'}: "${input.value}" (期望: "${customName}")`);

    return { success: ok, reason: ok ? 'filled' : 'value-mismatch', customLocationValue: input.value };
  } catch (err) {
    console.error(`[ClassSync Fill] 自定義地點填寫錯誤:`, err);
    return { success: false, reason: 'fill-error', customLocationValue: null, error: err?.message };
  }
}

// tschoolkit（彈窗）：依 payload 填值 - 重構為三輪式架構
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
        ok: false,
        reason: "modal-not-visible",
        details: "Modal is not visible",
        filledDays: 0,
        totalDays: payload.days.length,
        errors: [{ err: "modal-not-visible", details: "Modal is not visible" }],
        successRate: 0
      };
    }

    // === 三輪式填寫流程 ===

    // 第一輪：分析所有下拉選單的可用選項
    console.log("[ClassSync Fill] 🔄 第一輪：分析選項");
    const analysisResult = await analyzeModalOptions(modal, payload);

    // 第二輪：收集需要的輸入框
    console.log("[ClassSync Fill] 🔄 第二輪：收集輸入框");
    const inputsResult = await collectCustomInputs(analysisResult);

    // 第三輪：批次填寫所有資料
    console.log("[ClassSync Fill] 🔄 第三輪：批次填寫");
    const fillResult = await fillAllData(analysisResult, inputsResult);

    // 組裝最終結果
    const totalSlots = analysisResult.optionsBySlot.size;
    const filledSlots = fillResult.filledSlots;
    const slotsByDay = new Map();

    // 按日期組織結果
    for (const day of payload.days) {
      slotsByDay.set(day.dateISO, { slotsCount: day.slots.length, filledCount: 0 });
    }

    // 計算每日成功率
    for (const detail of fillResult.details) {
      const [dateISO] = detail.slotKey.split(':');
      const dayInfo = slotsByDay.get(dateISO);
      if (dayInfo && detail.success) {
        dayInfo.filledCount++;
      }
    }

    // 計算成功的天數
    let filledDays = 0;
    for (const [, dayInfo] of slotsByDay) {
      if (dayInfo.filledCount === dayInfo.slotsCount) {
        filledDays++;
      }
    }

    const result = {
      ok: fillResult.errors.length === 0,
      filledDays,
      totalDays: payload.days.length,
      errors: fillResult.errors,
      details: fillResult.details,
      successRate: filledDays / payload.days.length
    };

    console.log(`[ClassSync Fill] ✅ 三輪式填寫完成: ${filledDays}/${payload.days.length} 天成功，${filledSlots}/${totalSlots} 個時段成功，錯誤數 ${fillResult.errors.length}`);

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

  try {
    const payload = await resolvePayload();
    console.log("[ClassSync] 使用的 payload:", payload);

    // 1) 打開/切到 1Campus
    console.log("[ClassSync] 步驟 1: 打開或切換到 1Campus");
    const tabId = await openOrFocus(ONECAMPUS);
    console.log("[ClassSync] 1Campus 分頁 ID:", tabId);

  // 2) 智能等待 1Campus 頁面完全載入
  console.log("[ClassSync] 步驟 2a: 智能等待 1Campus 頁面完全載入");
  const pageReady = await waitFor1CampusReady(tabId, 50, 1000);

  if (!pageReady.ready) {
    console.error("[ClassSync] ❌ 1Campus 頁面載入超時:", pageReady.reason);
    throw new Error(`1Campus 頁面載入失敗: ${pageReady.reason}`);
  }

  console.log("[ClassSync] ✅ 1Campus 頁面已完全載入:", pageReady);

  // 額外檢查頁面狀態
  let pageStatus = null;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: check1CampusPageStatus,
      args: []
    });
    pageStatus = result;
    console.log("[ClassSync] 頁面狀態檢查:", pageStatus);

    if (pageStatus.isLoginPage) {
      console.error("[ClassSync] ❌ 檢測到登入頁面，請先手動登入");
      throw new Error("檢測到登入頁面，請先手動登入");
    }

    if (pageStatus.hasError) {
      console.error("[ClassSync] ❌ 頁面有錯誤訊息:", pageStatus.errorMessage);
    }
  } catch (e) {
    console.error("[ClassSync] 檢查頁面狀態失敗:", e);
  }

  // 2b) 智能搜尋並點擊「學習週曆」卡
  console.log("[ClassSync] 步驟 2b: 智能搜尋並點擊「學習週曆」卡");
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

  // 改進的重試機制：更少但更智能的嘗試
  const maxClickAttempts = 8;
  for (let i = 0; i < maxClickAttempts; i++) {
    console.log(`[ClassSync] 嘗試點擊「學習週曆」第 ${i+1}/${maxClickAttempts} 次`);

    try {
      // 每次嘗試前稍微等待，讓頁面穩定
      if (i > 0) {
        await sleep(1000 + i * 200); // 遞增等待時間
      }

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickLearningCalendarCard,
        args: []
      });

      if (result) {
        clicked = true;
        console.log("[ClassSync] ✅ 成功點擊「學習週曆」卡");

        // 等待並檢查 URL 變化
        await sleep(1500);
        const tab = await chrome.tabs.get(tabId);
        if (tab.url !== currentUrl) {
          console.log("[ClassSync] ✅ 檢測到 URL 變化:", tab.url);
        } else {
          console.warn("[ClassSync] ⚠️ 點擊後 URL 未變化，可能需要額外步驟");
        }
        break;
      } else {
        console.log(`[ClassSync] 第 ${i+1} 次嘗試未找到「學習週曆」元素`);

        // 如果前幾次嘗試失敗，檢查頁面是否還在載入
        if (i < 3) {
          const [{ result: loadingCheck }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const hasLoading = !!document.querySelector('.loading, .spinner, [data-loading]');
              const readyState = document.readyState;
              const elementCount = document.querySelectorAll('*').length;
              return { hasLoading, readyState, elementCount };
            },
            args: []
          });
          console.log(`[ClassSync] 頁面載入檢查 (嘗試${i+1}):`, loadingCheck);
        }
      }
    } catch (e) {
      console.log(`[ClassSync] 嘗試點擊「學習週曆」第 ${i+1} 次發生錯誤:`, e.message);
    }
  }

  if (!clicked) {
    console.error("[ClassSync] ❌ 無法找到或點擊「學習週曆」卡");
    console.log("[ClassSync] 💡 建議：請檢查頁面是否已載入完成，或嘗試手動點擊一次");
    throw new Error("無法點擊學習週曆卡");
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
    uiState.isRunning = false;
    notifyUI('PROCESS_ERROR', { error: '等待 tschoolkit 新分頁超時' });
  }, 30000);

  } catch (error) {
    console.error("[ClassSync] 主流程執行失敗:", error);
    uiState.isRunning = false;

    // 提供更詳細的錯誤資訊
    const errorInfo = categorizeError(error);
    notifyUI('PROCESS_ERROR', { error: errorInfo.userMessage });

    // 記錄詳細錯誤用於除錯
    console.error("[ClassSync] 錯誤分類:", errorInfo);

    throw error;
  }
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
        func: async (payload) => {
          // 使用重構後的三輪式填寫邏輯
          try {
            console.log("[ClassSync Fill] 開始填寫 Modal，payload:", payload);
            console.log("[ClassSync Fill Debug] 執行環境檢查 - window 存在:", typeof window !== 'undefined');
            console.log("[ClassSync Fill Debug] 執行環境檢查 - document 存在:", typeof document !== 'undefined');

            // 內聯必要的輔助函數
            function normalizeSlot(slot) {
              if (typeof slot === 'string') {
                // 處理舊格式的自訂地點："其他地點:地點名稱"
                if (slot.includes(':') && slot.startsWith('其他地點:')) {
                  const customName = slot.substring(5); // 移除 "其他地點:" 前綴（5個字符）
                  return {
                    location: "其他地點",
                    customName: customName.trim(),
                    isCustom: true
                  };
                }
                // 標準地點
                return {
                  location: slot,
                  customName: null,
                  isCustom: false
                };
              } else if (typeof slot === 'object' && slot !== null && slot.location && slot.customName) {
                // 新格式的自訂地點物件
                return {
                  location: slot.location,
                  customName: slot.customName,
                  isCustom: true
                };
              }

              // 無效格式，返回預設值
              return {
                location: "在家中",
                customName: null,
                isCustom: false
              };
            }

            console.log("[ClassSync Fill Debug] normalizeSlot 函數已定義:", typeof normalizeSlot === 'function');


            // 內聯新版本的輔助函數
            // 更穩健的可編輯判斷
            function isEditable(el) {
              if (!el) return false;
              const cs = window.getComputedStyle(el);
              const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
              const enabled = !el.disabled && !el.readOnly && !el.hasAttribute('aria-disabled');
              return visible && enabled;
            }

            // 以 MutationObserver + 兩次 rAF 等待「真的可編輯」
            function waitUntilEditable(targetEl, { timeout = 3000 } = {}) {
              return new Promise((resolve) => {
                if (isEditable(targetEl)) return resolve(true);

                let done = false;
                const stop = () => { if (!done) { done = true; obs.disconnect(); clearTimeout(tid); } };

                const obs = new MutationObserver(async () => {
                  // 多等兩個 animation frame，確保 layout 與樣式完成
                  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                  if (isEditable(targetEl)) { stop(); resolve(true); }
                });

                obs.observe(document.documentElement, { attributes: true, childList: true, subtree: true });

                const tid = setTimeout(() => { stop(); resolve(false); }, timeout);
              });
            }

            // 修復後的自定義地點填寫相關函數

            // 比原本「寬高>0」更穩定：看 computedStyle 與禁用態
            function isInputReady(input) {
              if (!input) return false;
              const cs = getComputedStyle(input);
              const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
              return visible && !input.disabled && !input.readOnly;
            }

            // 用原生 setter 寫值，解決 React/受控輸入不同步
            function setNativeInputValue(input, value) {
              // 使用 HTMLInputElement.prototype.value setter 確保跳過任何框架攔截
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

              if (nativeSetter) {
                nativeSetter.call(input, value);
              } else {
                // 理論上不會走到這，但保底
                input.value = value;
              }

              // 對受控元件，input 事件是關鍵
              input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            }

            // 等待/取得該 slot 的自訂輸入框：優先用 MutationObserver，退而求其次輪詢
            function getOrWaitCustomInput(container, select, maxWaitMs = 3000) {
              return new Promise((resolve) => {
                // 先查一次
                const q = () => container?.querySelector('input[type="text"], input[placeholder*="地點"], input[placeholder*="名稱"], input.input');
                let found = q();
                if (found) return resolve(found);

                // 確保 select 已是「其他地點」
                if (select && select.value !== '其他地點') {
                  select.value = '其他地點';
                  select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                  select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                }

                // 用 MutationObserver 等待輸入框出現
                const obs = new MutationObserver(() => {
                  const el = q();
                  if (el) {
                    obs.disconnect();
                    resolve(el);
                  }
                });
                if (container) {
                  obs.observe(container, { childList: true, subtree: true });
                }

                // 兜底 timeout
                setTimeout(() => {
                  obs.disconnect();
                  resolve(q() || null);
                }, maxWaitMs);
              });
            }

            async function fillCustomLocation(container, customName, slotIndex) {
              console.log(`測試填寫自訂地點: 時段 ${slotIndex + 1}, 地點: "${customName}"`);
              try {
                const select = container?.querySelector('select');

                // 確保「其他地點」已選
                if (select && select.value !== '其他地點') {
                  select.value = '其他地點';
                  select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                  select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                }

                // 取得或等待 input
                const input = await getOrWaitCustomInput(container, select, 3000);

                if (!input) {
                  console.error(`時段 ${slotIndex + 1}: 找不到輸入框`);
                  return { success: false, reason: 'no-input', customLocationValue: null };
                }

                // 有些站點會短暫設為 readonly/disabled，這裡強制解除一次
                input.disabled = false;
                input.readOnly = false;

                // 滾到可見（避免某些框架對不可見元素忽略事件）
                input.scrollIntoView?.({ block: 'center', inline: 'nearest' });

                // 就算 isInputReady 回 false，也先試著填 — 很多時候其實能寫
                input.focus();
                setNativeInputValue(input, customName);
                input.blur();

                // 驗證
                const ok = input.value === customName;
                console.log(`時段 ${slotIndex + 1}: 自訂地點填寫 ${ok ? '✅' : '❌'} "${customName}" -> "${input.value}"`);
                return { success: ok, reason: ok ? 'filled' : 'value-mismatch', customLocationValue: input.value };
              } catch (err) {
                console.error(`時段 ${slotIndex + 1}: 填寫時發生錯誤:`, err);
                return { success: false, reason: 'fill-error', customLocationValue: null, error: err?.message };
              }
            }

            console.log("[ClassSync Fill Debug] fillCustomLocation 函數已定義:", typeof fillCustomLocation === 'function');

            // 檢查執行環境
            if (typeof document === 'undefined') {
              console.error("[ClassSync Fill] ❌ Document 物件不存在，執行環境異常");
              return {
                ok: false,
                reason: "no-document",
                details: "Document object not available",
                filledDays: 0,
                totalDays: payload?.days?.length || 0,
                errors: [{ err: "no-document", details: "Document object not available" }],
                successRate: 0
              };
            }

            // 檢查 payload 有效性
            if (!payload || !payload.days || !Array.isArray(payload.days)) {
              console.error("[ClassSync Fill] ❌ 無效的 payload 格式");
              return {
                ok: false,
                reason: "invalid-payload",
                details: "Invalid payload format",
                filledDays: 0,
                totalDays: 0,
                errors: [{ err: "invalid-payload", details: "Payload is null or missing days array" }],
                successRate: 0
              };
            }

            // 檢查 modal 容器 - 更新選擇器以匹配實際 HTML 結構
            const modal = document.querySelector(".modal-box") ||
                         document.querySelector('[role="dialog"]') ||
                         document.querySelector('.modal') ||
                         document.querySelector('#next-week-event-modal .modal-box');

            if (!modal) {
              console.error("[ClassSync Fill] ❌ 找不到 modal 容器");
              return {
                ok: false,
                reason: "no-modal",
                details: "Modal element not found",
                filledDays: 0,
                totalDays: payload.days.length,
                errors: [{ err: "no-modal", details: "Modal element not found" }],
                successRate: 0
              };
            }

            console.log("[ClassSync Fill] ✅ 找到 modal 容器:", modal);

            // 檢查 modal 是否可見
            if (modal.offsetWidth === 0 || modal.offsetHeight === 0) {
              console.error("[ClassSync Fill] ❌ Modal 不可見");
              return {
                ok: false,
                reason: "modal-not-visible",
                details: "Modal is not visible",
                filledDays: 0,
                totalDays: payload.days.length,
                errors: [{ err: "modal-not-visible", details: "Modal is not visible" }],
                successRate: 0
              };
            }

            const result = {
              ok: true,
              filledDays: 0,
              totalDays: payload.days.length,
              errors: [],
              details: []
            };

            // 找到日期區塊：<div class="p-4 space-y-4">
            const blocks = Array.from(modal.querySelectorAll(".p-4.space-y-4"));
            console.log(`[ClassSync Fill] 找到 ${blocks.length} 個日期區塊`);

            if (!blocks.length) {
              console.error("[ClassSync Fill] ❌ 找不到日期區塊");
              return {
                ok: false,
                reason: "no-day-blocks",
                details: "No day blocks found in modal",
                filledDays: 0,
                totalDays: payload.days.length,
                errors: [{ err: "no-day-blocks", details: "No day blocks found in modal" }],
                successRate: 0
              };
            }

            // 建立日期對應表
            const blockByDate = new Map();
            blocks.forEach((block, index) => {
              const title = block.querySelector("p.text-xl.text-primary");
              const txt = (title?.textContent || "").trim();
              const dateStr = txt.slice(0, 10); // 提取 YYYY-MM-DD 格式
              blockByDate.set(dateStr, block);
              console.log(`[ClassSync Fill] 區塊 ${index + 1}: ${txt} -> ${dateStr}`);
            });

            // 逐日填寫
            for (const d of payload.days) {
              console.log(`[ClassSync Fill] 處理日期: ${d.dateISO}, 地點: [${d.slots.join(', ')}]`);

              const block = blockByDate.get(d.dateISO);
              if (!block) {
                const error = { date: d.dateISO, err: "block-not-found" };
                result.errors.push(error);
                console.error(`[ClassSync Fill] ❌ 找不到日期區塊: ${d.dateISO}`);
                continue;
              }

              const selects = Array.from(block.querySelectorAll("select"));
              console.log(`[ClassSync Fill] 日期 ${d.dateISO} 找到 ${selects.length} 個下拉選單`);

              if (!selects.length) {
                const error = { date: d.dateISO, err: "no-selects" };
                result.errors.push(error);
                console.error(`[ClassSync Fill] ❌ 日期 ${d.dateISO} 找不到下拉選單`);
                continue;
              }

              let dayFilled = true;
              const dayDetails = { date: d.dateISO, slots: [] };

              // 填寫每個時段
              for (let i = 0; i < Math.min(selects.length, d.slots.length); i++) {
                const sel = selects[i];
                const rawSlot = d.slots[i];

                console.log(`[ClassSync Fill Debug] 時段 ${i + 1}: 原始 slot 資料:`, rawSlot);
                console.log(`[ClassSync Fill Debug] 時段 ${i + 1}: normalizeSlot 函數存在:`, typeof normalizeSlot === 'function');

                const normalizedSlot = normalizeSlot(rawSlot);

                console.log(`[ClassSync Fill Debug] 時段 ${i + 1}: 標準化後的 slot:`, normalizedSlot);
                const opts = Array.from(sel.options || []);

                console.log(`[ClassSync Fill] 時段 ${i + 1}: 處理 slot`, normalizedSlot);
                console.log(`[ClassSync Fill] 可用選項: [${opts.map(o => `"${o.value}": "${o.textContent?.trim()}"`).join(', ')}]`);

                // 尋找匹配的選項 - 使用標準化後的地點名稱
                const wantedLocation = normalizedSlot.location;
                let target = opts.find(o => {
                  const optText = (o.textContent || "").trim();
                  const optValue = (o.value || "").trim();
                  return optText === wantedLocation || optValue === wantedLocation;
                });

                if (!target) {
                  // 嘗試模糊匹配
                  target = opts.find(o => {
                    const optText = (o.textContent || "").trim();
                    return optText.includes(wantedLocation) || wantedLocation.includes(optText);
                  });
                }

                if (!target) {
                  // 如果找不到匹配，使用第一個非 disabled 的有效選項
                  target = opts.find(o =>
                    !o.disabled &&
                    o.value &&
                    o.value !== "none" &&
                    o.value !== "" &&
                    (o.textContent || "").trim() !== ""
                  );
                }

                if (target) {
                  const oldValue = sel.value;

                  // 同步選項狀態並觸發事件
                  target.selected = true;
                  sel.value = target.value;
                  sel.dispatchEvent(new Event("change", { bubbles: true }));
                  sel.dispatchEvent(new Event("input", { bubbles: true }));

                  // 等待 DOM/框架更新
                  await new Promise(r => setTimeout(r, 100));

                  // 處理自訂地點填寫
                  let customLocationResult = { success: true, customLocationValue: null };

                  if (normalizedSlot.isCustom && target.value === "其他地點") {
                    const container = sel.closest('.w-full');
                    customLocationResult = await fillCustomLocation(container, normalizedSlot.customName, i);
                  }

                  // 驗證是否設定成功
                  const newValue = sel.value;
                  const selectSuccess = newValue === target.value;
                  const overallSuccess = selectSuccess && customLocationResult.success;

                  console.log(`[ClassSync Fill] 時段 ${i + 1}: ${overallSuccess ? '✅' : '❌'} ${JSON.stringify(normalizedSlot)} -> "${target.textContent?.trim()}" (${oldValue} -> ${newValue})${customLocationResult.customLocationValue ? ` + 自訂地點: "${customLocationResult.customLocationValue}"` : ''}`);

                  dayDetails.slots.push({
                    index: i,
                    wanted: normalizedSlot,
                    selected: target.textContent?.trim(),
                    value: target.value,
                    oldValue: oldValue,
                    newValue: newValue,
                    customLocationValue: customLocationResult.customLocationValue,
                    success: overallSuccess
                  });

                  if (!overallSuccess) {
                    dayFilled = false;
                    result.errors.push({
                      date: d.dateISO,
                      idx: i,
                      err: selectSuccess ? "custom-location-failed" : "set-value-failed",
                      wanted: normalizedSlot,
                      attempted: target.value,
                      oldValue: oldValue,
                      newValue: newValue,
                      customLocationResult: customLocationResult,
                      selectSuccess: selectSuccess
                    });
                  }
                } else {
                  console.error(`[ClassSync Fill] ❌ 時段 ${i + 1}: 找不到適合的選項給`, normalizedSlot);
                  dayFilled = false;
                  result.errors.push({
                    date: d.dateISO,
                    idx: i,
                    err: "option-not-found",
                    wanted: normalizedSlot,
                    availableOptions: opts.map(o => `"${o.value}": "${o.textContent?.trim()}"`).filter(Boolean)
                  });

                  dayDetails.slots.push({
                    index: i,
                    wanted: normalizedSlot,
                    selected: null,
                    value: null,
                    success: false
                  });
                }
              }

              result.details.push(dayDetails);
              if (dayFilled) {
                result.filledDays += 1;
              }
            }

            // 計算成功率
            result.successRate = result.totalDays > 0 ? result.filledDays / result.totalDays : 0;
            result.ok = result.errors.length === 0;

            console.log(`[ClassSync Fill] 填寫完成: ${result.filledDays}/${result.totalDays} 天成功，錯誤數 ${result.errors.length}`);
            console.log(`[ClassSync Fill] 詳細結果:`, result);

            return result;

          } catch (error) {
            console.error("[ClassSync Fill] ❌ 函數執行時發生未預期錯誤:", error);

            // 確保總是返回一個有效的結果對象
            return {
              ok: false,
              reason: "unexpected-error",
              details: error.message || "Unknown error occurred",
              filledDays: 0,
              totalDays: payload?.days?.length || 0,
              errors: [{
                err: "unexpected-error",
                details: error.message || "Unknown error occurred",
                stack: error.stack
              }],
              successRate: 0
            };
          }
        },
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
    uiState.isRunning = false;
    notifyUI('PROCESS_COMPLETED', { success: true, data: payload });
    if (submissionResult.successMessage) {
      console.log(`[ClassSync] ✅ 成功訊息: "${submissionResult.successMessage}"`);
    }
    if (submissionResult.modalClosed) {
      console.log("[ClassSync] ✅ Modal 已關閉");
    }
  } else if (submissionResult.errorMessage) {
    console.error(`[ClassSync] ❌ 提交失敗: ${submissionResult.errorMessage}`);
    uiState.isRunning = false;
    notifyUI('PROCESS_ERROR', { error: submissionResult.errorMessage });
    throw new Error(`Submission failed: ${submissionResult.errorMessage}`);
  } else {
    console.warn("[ClassSync] ⚠️ 提交狀態不明確，但流程已完成");
    uiState.isRunning = false;
    notifyUI('PROCESS_COMPLETED', { success: true, data: payload });
    console.log("[ClassSync] 📋 狀態資訊:", {
      modalClosed: submissionResult.modalClosed,
      url: submissionResult.currentUrl,
      title: submissionResult.pageTitle
    });
  }

  } catch (error) {
    console.error("[ClassSync tschoolkit] 執行流程時發生錯誤:", error.message);
    console.error("[ClassSync tschoolkit] 錯誤堆疊:", error.stack);

    // 使用統一的錯誤分類系統
    const errorInfo = categorizeError(error);
    console.log("[ClassSync tschoolkit] 錯誤分析:", errorInfo);

    // 嘗試獲取當前頁面狀態以便診斷
    try {
      const tab = await chrome.tabs.get(tabId);
      console.log("[ClassSync tschoolkit] 錯誤時的頁面狀態:", {
        url: tab.url,
        title: tab.title,
        status: tab.status,
        errorCategory: errorInfo.category
      });
    } catch (tabError) {
      console.error("[ClassSync tschoolkit] 無法獲取錯誤時的頁面狀態:", tabError.message);
    }

    // 通知 UI 更友善的錯誤訊息
    uiState.isRunning = false;
    notifyUI('PROCESS_ERROR', { error: errorInfo.userMessage });

    throw error; // 重新拋出錯誤，讓上層處理
  }
}

// 點擴充圖示就跑（若未接到外部 payload，會自動用 DUMMY）
chrome.action.onClicked.addListener(() => {
  console.log("[ClassSync] 📱 擴充功能圖示被點擊，開始執行...");
  if (!uiState.isRunning) {
    uiState.isRunning = true;
    notifyUI('PROCESS_STARTED');
    startFlow().catch(error => {
      console.error("[ClassSync] 點擊圖示執行失敗:", error);
      uiState.isRunning = false;
      notifyUI('PROCESS_ERROR', { error: error.message });
    });
  }
});