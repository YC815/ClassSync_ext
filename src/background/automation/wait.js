export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForElement(tabId, selector, maxAttempts = 30, interval = 500) {
  console.log(`[ClassSync Wait] 等待元素: ${selector}`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const element = document.querySelector(sel);
          return {
            found: !!element,
            visible: element ? element.offsetWidth > 0 && element.offsetHeight > 0 : false,
            text: element ? element.textContent?.trim() : null
          };
        },
        args: [selector]
      });

      if (result.found && result.visible) {
        console.log(`[ClassSync Wait] ✅ 元素已出現並可見: ${selector}`);
        return true;
      }

      console.log(
        `[ClassSync Wait] 嘗試 ${i + 1}/${maxAttempts}: 元素狀態 - 找到: ${result.found}, 可見: ${result.visible}`
      );
      await sleep(interval);
    } catch (error) {
      console.log(`[ClassSync Wait] 檢查元素時出錯 (嘗試 ${i + 1}): ${error.message}`);
      await sleep(interval);
    }
  }

  console.error(`[ClassSync Wait] ❌ 等待元素超時: ${selector}`);
  return false;
}

export async function waitFor1CampusReady(tabId, maxAttempts = 50, interval = 1000) {
  console.log(`[ClassSync Wait] 等待 1Campus 頁面完全載入...`);

  const check1CampusReady = () => {
    if (document.readyState !== "complete") {
      return { ready: false, reason: "document-not-ready", readyState: document.readyState };
    }

    const loadingSelectors = [
      ".loading",
      ".spinner",
      "[data-loading]",
      ".loader",
      ".loading-overlay",
      ".progress",
      ".skeleton"
    ];

    for (const selector of loadingSelectors) {
      const loading = document.querySelector(selector);
      if (loading && loading.offsetWidth > 0 && loading.offsetHeight > 0) {
        return { ready: false, reason: "still-loading", selector };
      }
    }

    const contentSelectors = [
      "main",
      ".main-content",
      ".content",
      ".app-content",
      '[role="main"]',
      ".container",
      ".layout"
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
      return { ready: false, reason: "no-main-content" };
    }

    const learningCalendarImg = document.querySelector('img[alt="學習週曆"]');
    const learningCalendarText = Array.from(document.querySelectorAll("*")).find((el) =>
      el.textContent?.includes("學習週曆")
    );

    const cardSelectors = [
      ".card",
      ".btn",
      "button",
      '[role="button"]',
      ".item",
      ".tile",
      ".panel",
      "a[href]"
    ];

    let hasInteractiveElements = false;
    for (const selector of cardSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        hasInteractiveElements = true;
        break;
      }
    }

    if (!hasInteractiveElements) {
      return { ready: false, reason: "no-interactive-elements" };
    }

    const bodyContent = document.body.textContent?.trim();
    if (!bodyContent || bodyContent.length < 100) {
      return {
        ready: false,
        reason: "insufficient-content",
        contentLength: bodyContent?.length || 0
      };
    }

    return {
      ready: true,
      hasLearningCalendar: !!(learningCalendarImg || learningCalendarText),
      hasMainContent,
      hasInteractiveElements,
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
    } catch (error) {
      console.log(`[ClassSync Wait] 檢查頁面狀態時出錯 (嘗試 ${i + 1}): ${error.message}`);
      await sleep(interval);
    }
  }

  console.error(`[ClassSync Wait] ❌ 等待 1Campus 頁面準備超時`);
  return { ready: false, reason: "timeout" };
}

export async function waitForPageStateChange(tabId, checkFunction, maxAttempts = 20, interval = 500) {
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
    } catch (error) {
      console.log(`[ClassSync Wait] 檢查狀態時出錯 (嘗試 ${i + 1}): ${error.message}`);
      await sleep(interval);
    }
  }

  console.error(`[ClassSync Wait] ❌ 等待狀態變化超時`);
  return false;
}

export async function waitForModalReady(tabId, maxAttempts = 15, interval = 400) {
  console.log(`[ClassSync Wait] 等待 Modal 完全載入...`);

  const checkModalReady = () => {
    const modal = document.querySelector(".modal-box") || document.querySelector('[role="dialog"], .modal');
    if (!modal) return false;

    const isVisible = modal.offsetWidth > 0 && modal.offsetHeight > 0;
    if (!isVisible) return false;

    const blocks = modal.querySelectorAll(".p-4.space-y-4");
    if (blocks.length === 0) return false;

    const selects = modal.querySelectorAll("select");
    if (selects.length === 0) return false;

    let allSelectsReady = true;
    selects.forEach((select) => {
      if (select.options.length <= 1) {
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

export async function openOrFocus(urlPrefix) {
  const tabs = await chrome.tabs.query({});
  const exist = tabs.find((tab) => tab.url && tab.url.startsWith(urlPrefix));
  if (exist) {
    await chrome.tabs.update(exist.id, { active: true });
    return exist.id;
  }
  const tab = await chrome.tabs.create({ url: urlPrefix });
  return tab.id;
}

export async function execInTab(tabId, func, ...args) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
}

export function onTabCompleteOnce(tabId, urlStartsWith, handler, timeoutMs = 30000) {
  console.log(`[ClassSync Monitor] 開始監控分頁 ${tabId} 跳轉到 ${urlStartsWith}`);

  const listener = async (updatedTabId, changeInfo, updatedTab) => {
    if (updatedTabId !== tabId) return;

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
      console.log(
        `[ClassSync Monitor] URL 不符合預期，繼續等待... (期待: ${urlStartsWith})`
      );
      return;
    }

    console.log(`[ClassSync Monitor] ✅ 成功跳轉到目標頁面: ${url}`);
    chrome.tabs.onUpdated.removeListener(listener);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    try {
      await handler(updatedTabId);
    } catch (error) {
      console.error(`[ClassSync Monitor] 處理器執行錯誤:`, error);
    }
  };

  const timeoutId = setTimeout(() => {
    console.error(`[ClassSync Monitor] ❌ 等待跳轉超時 (${timeoutMs}ms)，移除監聽器`);
    chrome.tabs.onUpdated.removeListener(listener);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        console.log(`[ClassSync Monitor] 超時時的分頁狀態:`, {
          url: tab.url,
          title: tab.title,
          status: tab.status
        });
      })
      .catch((error) => {
        console.error(`[ClassSync Monitor] 無法獲取分頁資訊:`, error);
      });
  }, timeoutMs);

  chrome.tabs.onUpdated.addListener(listener);
}

export async function waitForSubmissionResult(tabId, maxAttempts = 20, interval = 500) {
  console.log("[ClassSync Submit] 等待提交結果確認...");

  const checkSubmissionResult = () => {
    const successIndicators = [
      ".alert-success",
      ".success",
      ".message-success",
      ".toast-success",
      ".notification-success",
      '[class*="success"]',
      '[data-alert="success"]'
    ];

    const errorIndicators = [
      ".alert-error",
      ".error",
      ".message-error",
      ".toast-error",
      ".notification-error",
      '[class*="error"]',
      '[data-alert="error"]',
      ".alert-danger",
      ".danger"
    ];

    const modal =
      document.querySelector(".modal-box") || document.querySelector('[role="dialog"], .modal');
    const modalClosed = !modal || modal.offsetWidth === 0 || modal.offsetHeight === 0;

    let successMessage = null;
    for (const selector of successIndicators) {
      const element = document.querySelector(selector);
      if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
        successMessage = element.textContent?.trim();
        break;
      }
    }

    let errorMessage = null;
    for (const selector of errorIndicators) {
      const element = document.querySelector(selector);
      if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
        errorMessage = element.textContent?.trim();
        break;
      }
    }

    const currentUrl = window.location.href;
    const urlChanged = !currentUrl.includes("/calendar") && !currentUrl.includes("tschoolkit");

    const pageTitle = document.title;
    const hasCalendar = !!document.querySelector('[class*="calendar"], [class*="週曆"], .weekly-calendar');

    return {
      success: modalClosed && !errorMessage,
      modalClosed,
      successMessage,
      errorMessage,
      urlChanged,
      currentUrl,
      pageTitle,
      hasCalendar
    };
  };

  return await waitForPageStateChange(tabId, checkSubmissionResult, maxAttempts, interval);
}
