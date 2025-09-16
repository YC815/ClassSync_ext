import { ONECAMPUS, TSKIT } from "../constants.js";
import { resolvePayload } from "../payload.js";
import { notifyUI, setProcessRunning } from "../state.js";
import { categorizeError } from "../errors.js";
import {
  sleep,
  waitFor1CampusReady,
  waitForElement,
  waitForModalReady,
  waitForSubmissionResult,
  openOrFocus
} from "./wait.js";
import {
  check1CampusPageStatus,
  clickLearningCalendarCard,
  clickTabByText,
  clickWeeklyReportButton,
  clickReportPlanButton
} from "../dom/navigation.js";
import { fillModalInPage } from "../dom/fillModal.js";

export async function startFlow() {
  console.log("[ClassSync] 🚀 開始執行自動化流程");

  try {
    const payload = await resolvePayload();
    console.log("[ClassSync] 使用的 payload:", payload);

    console.log("[ClassSync] 步驟 1: 打開或切換到 1Campus");
    const tabId = await openOrFocus(ONECAMPUS);
    console.log("[ClassSync] 1Campus 分頁 ID:", tabId);

    console.log("[ClassSync] 步驟 2a: 智能等待 1Campus 頁面完全載入");
    const pageReady = await waitFor1CampusReady(tabId, 50, 1000);

    if (!pageReady.ready) {
      console.error("[ClassSync] ❌ 1Campus 頁面載入超時:", pageReady.reason);
      throw new Error(`1Campus 頁面載入失敗: ${pageReady.reason}`);
    }

    console.log("[ClassSync] ✅ 1Campus 頁面已完全載入:", pageReady);

    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: check1CampusPageStatus,
        args: []
      });

      if (result.isLoginPage) {
        console.error("[ClassSync] ❌ 檢測到登入頁面，請先手動登入");
        throw new Error("檢測到登入頁面，請先手動登入");
      }

      if (result.hasError) {
        console.error("[ClassSync] ❌ 頁面有錯誤訊息:", result.errorMessage);
      }
    } catch (statusError) {
      console.error("[ClassSync] 檢查頁面狀態失敗:", statusError);
    }

    console.log("[ClassSync] 步驟 2b: 智能搜尋並點擊「學習週曆」卡");
    let clicked = false;
    let currentUrl = null;

    try {
      const tab = await chrome.tabs.get(tabId);
      currentUrl = tab.url;
    } catch (tabError) {
      console.error("[ClassSync] 無法獲取當前 URL:", tabError);
    }

    const maxClickAttempts = 8;
    for (let attempt = 0; attempt < maxClickAttempts; attempt++) {
      console.log(`[ClassSync] 嘗試點擊「學習週曆」第 ${attempt + 1}/${maxClickAttempts} 次`);

      try {
        if (attempt > 0) {
          await sleep(1000 + attempt * 200);
        }

        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: clickLearningCalendarCard,
          args: []
        });

        if (result) {
          clicked = true;
          console.log("[ClassSync] ✅ 成功點擊「學習週曆」卡");

          await sleep(1500);
          const tab = await chrome.tabs.get(tabId);
          if (currentUrl && tab.url !== currentUrl) {
            console.log("[ClassSync] ✅ 檢測到 URL 變化:", tab.url);
          }
          break;
        }

        console.log(`[ClassSync] 第 ${attempt + 1} 次嘗試未找到「學習週曆」元素`);

        if (attempt < 3) {
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
          console.log(`[ClassSync] 頁面載入檢查 (嘗試${attempt + 1}):`, loadingCheck);
        }
      } catch (clickError) {
        console.log(`[ClassSync] 嘗試點擊「學習週曆」第 ${attempt + 1} 次發生錯誤:`, clickError.message);
      }
    }

    if (!clicked) {
      console.error("[ClassSync] ❌ 無法找到或點擊「學習週曆」卡");
      throw new Error("無法點擊學習週曆卡");
    }

    console.log("[ClassSync] 步驟 3: 監控新分頁創建，等待 tschoolkit...");

    const onTabCreated = async (tab) => {
      console.log(`[ClassSync Monitor] 新分頁被創建: ${tab.url || '(URL未知)'}`);

      if (tab.url && tab.url.startsWith(TSKIT)) {
        console.log(`[ClassSync Monitor] ✅ 檢測到 tschoolkit 新分頁: ${tab.id}`);
        chrome.tabs.onCreated.removeListener(onTabCreated);

        const onTabComplete = (updatedTabId, changeInfo, updatedTab) => {
          if (updatedTabId !== tab.id) return;
          if (changeInfo.status !== "complete") return;

          console.log(`[ClassSync Monitor] tschoolkit 分頁載入完成: ${updatedTab.url}`);
          chrome.tabs.onUpdated.removeListener(onTabComplete);

          executeTschoolkitFlow(tab.id).catch((error) => {
            console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", error);
          });
        };

        chrome.tabs.onUpdated.addListener(onTabComplete);

        if (tab.status === "complete") {
          console.log("[ClassSync Monitor] 分頁已載入完成，直接執行");
          executeTschoolkitFlow(tab.id).catch((error) => {
            console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", error);
          });
        }
      } else {
        console.log(`[ClassSync Monitor] 監聽分頁 ${tab.id} 的 URL 更新...`);

        const onTabUpdated = (updatedTabId, changeInfo, updatedTab) => {
          if (updatedTabId !== tab.id) return;

          if (changeInfo.url && changeInfo.url.startsWith(TSKIT)) {
            console.log(`[ClassSync Monitor] ✅ 檢測到 tschoolkit URL: ${tab.id}`);
            chrome.tabs.onCreated.removeListener(onTabCreated);
            chrome.tabs.onUpdated.removeListener(onTabUpdated);

            const onTschoolkitComplete = (completedTabId, completedChangeInfo, completedTab) => {
              if (completedTabId !== tab.id) return;
              if (completedChangeInfo.status !== "complete") return;

              console.log(`[ClassSync Monitor] tschoolkit 分頁載入完成: ${completedTab.url}`);
              chrome.tabs.onUpdated.removeListener(onTschoolkitComplete);

              executeTschoolkitFlow(tab.id).catch((error) => {
                console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", error);
              });
            };

            chrome.tabs.onUpdated.addListener(onTschoolkitComplete);

            if (updatedTab.status === "complete") {
              console.log("[ClassSync Monitor] tschoolkit 分頁已載入完成，直接執行");
              executeTschoolkitFlow(tab.id).catch((error) => {
                console.error("[ClassSync Monitor] 執行 tschoolkit 流程時發生錯誤:", error);
              });
            }
          }
        };

        chrome.tabs.onUpdated.addListener(onTabUpdated);

        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onTabUpdated);
        }, 10000);
      }
    };

    chrome.tabs.onCreated.addListener(onTabCreated);

    const existingTabs = await chrome.tabs.query({});
    const existingTschoolkit = existingTabs.find((tab) => tab.url && tab.url.startsWith(TSKIT));

    if (existingTschoolkit) {
      console.log(`[ClassSync Monitor] 發現已存在的 tschoolkit 分頁: ${existingTschoolkit.id}`);
      chrome.tabs.onCreated.removeListener(onTabCreated);
      await chrome.tabs.update(existingTschoolkit.id, { active: true });

      setTimeout(() => {
        executeTschoolkitFlow(existingTschoolkit.id).catch((error) => {
          console.error("[ClassSync Monitor] 在現有分頁執行 tschoolkit 流程時發生錯誤:", error);
        });
      }, 1000);
      return;
    }

    setTimeout(() => {
      console.error("[ClassSync Monitor] ❌ 等待 tschoolkit 新分頁超時 (30秒)");
      chrome.tabs.onCreated.removeListener(onTabCreated);
      setProcessRunning(false);
      notifyUI('PROCESS_ERROR', { error: '等待 tschoolkit 新分頁超時' });
    }, 30000);
  } catch (error) {
    console.error("[ClassSync] 主流程執行失敗:", error);
    setProcessRunning(false);

    const errorInfo = categorizeError(error);
    notifyUI('PROCESS_ERROR', { error: errorInfo.userMessage });
    console.error("[ClassSync] 錯誤分類:", errorInfo);

    throw error;
  }
}

export async function executeTschoolkitFlow(tabId) {
  try {
    const payload = await resolvePayload();
    console.log(`[ClassSync tschoolkit] 開始在分頁 ${tabId} 執行流程，使用 payload:`, payload);

    try {
      const tab = await chrome.tabs.get(tabId);
      console.log(`[ClassSync tschoolkit] 分頁資訊:`, {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        status: tab.status
      });
    } catch (tabError) {
      console.error("[ClassSync tschoolkit] 無法獲取分頁資訊:", tabError);
      return;
    }

    console.log("[ClassSync] 步驟 4: 等待頁面載入並點擊「待填下週」標籤");

    const tabElementReady = await waitForElement(tabId, 'a.tab, button.tab, [role="tab"]', 20, 400);
    if (!tabElementReady) {
      console.error("[ClassSync] ❌ 等待標籤元素出現超時");
      throw new Error("Tab elements not found within timeout");
    }

    let tabClicked = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: clickTabByText,
          args: ["待填下週"]
        });

        if (result) {
          tabClicked = true;
          console.log("[ClassSync] ✅ 成功點擊「待填下週」標籤");
          await sleep(500);
          break;
        }
      } catch (clickError) {
        console.log(`[ClassSync] 嘗試點擊「待填下週」第 ${attempt + 1} 次失敗:`, clickError.message);
        await sleep(400);
      }
    }

    if (!tabClicked) {
      console.error("[ClassSync] ❌ 無法找到或點擊「待填下週」標籤");
      throw new Error("Unable to click '待填下週' tab");
    }

    console.log("[ClassSync] 步驟 5: 等待並點擊「週曆填報」按鈕");

    const buttonElementReady = await waitForElement(tabId, 'button, a, [role="button"]', 15, 400);
    if (!buttonElementReady) {
      console.error("[ClassSync] ❌ 等待按鈕元素出現超時");
      throw new Error("Button elements not found within timeout");
    }

    let reportClicked = false;
    for (let attempt = 0; attempt < 8; attempt++) {
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
      } catch (clickError) {
        console.log(`[ClassSync] 嘗試點擊「週曆填報」第 ${attempt + 1} 次失敗:`, clickError.message);
        await sleep(400);
      }
    }

    if (!reportClicked) {
      console.error("[ClassSync] ❌ 無法找到或點擊「週曆填報」按鈕");
      throw new Error("Unable to click '週曆填報' button");
    }

    console.log("[ClassSync] 步驟 6: 等待 Modal 完全載入並填寫表單...");

    const modalReady = await waitForModalReady(tabId, 15, 500);
    if (!modalReady || !modalReady.isReady) {
      console.error("[ClassSync] ❌ Modal 載入超時或未完全準備就緒:", modalReady);
      throw new Error("Modal not ready within timeout");
    }

    console.log(
      `[ClassSync] ✅ Modal 準備就緒: ${modalReady.blocksCount} 個日期區塊, ${modalReady.selectsCount} 個下拉選單`
    );

    let fillResult = null;
    let fillAttempts = 0;
    const maxFillAttempts = 5;

    while (fillAttempts < maxFillAttempts) {
      fillAttempts++;

      try {
        console.log(`[ClassSync] 步驟 ${fillAttempts}.1: 執行預檢查`);
        const preCheckResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            try {
              const modal =
                document.querySelector(".modal-box") ||
                document.querySelector('[role="dialog"]') ||
                document.querySelector('.modal');
              if (!modal) {
                return { ok: false, reason: 'no-modal' };
              }

              const modalStyle = window.getComputedStyle(modal);
              if (
                modalStyle.visibility === 'hidden' ||
                modalStyle.display === 'none' ||
                modalStyle.opacity === '0'
              ) {
                return { ok: false, reason: 'modal-not-visible' };
              }

              const blocks = Array.from(modal.querySelectorAll(".p-4.space-y-4"));
              if (!blocks.length) {
                return { ok: false, reason: 'no-day-blocks' };
              }

              return {
                ok: true,
                modalVisible: true,
                blocksCount: blocks.length,
                modalSize: { width: modal.offsetWidth, height: modal.offsetHeight }
              };
            } catch (error) {
              return { ok: false, reason: 'precheck-error', error: error.message };
            }
          },
          args: [],
          world: "MAIN"
        });

        if (!preCheckResult || !preCheckResult.length || !preCheckResult[0].result?.ok) {
          const reason = preCheckResult?.[0]?.result?.reason || "unknown";
          console.error(`[ClassSync] ❌ 預檢查失敗: ${reason}`);
          throw new Error(`Pre-check failed: ${reason}`);
        }

        console.log(`[ClassSync] ✅ 預檢查通過:`, preCheckResult[0].result);

        console.log(`[ClassSync] 步驟 ${fillAttempts}.2: 開始執行腳本注入`);
        const scriptResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: fillModalInPage,
          args: [payload],
          world: "MAIN"
        });

        if (!scriptResult || !scriptResult.length) {
          throw new Error("Script execution returned no results");
        }

        const { result } = scriptResult[0];
        if (!result) {
          throw new Error("Script execution returned null/undefined result");
        }

        fillResult = result;
        console.log(`[ClassSync] 填寫嘗試 ${fillAttempts}:`, {
          ok: result.ok,
          filledDays: result.filledDays,
          totalDays: result.totalDays,
          errorCount: result.errors ? result.errors.length : 'undefined',
          successRate: result.successRate
        });

        const hasValidResult = typeof result.ok === 'boolean' && typeof result.successRate === 'number';
        if (!hasValidResult) {
          console.error(`[ClassSync] ❌ 無效的填寫結果格式:`, result);
          throw new Error("Invalid fill result format");
        }

        if (result.ok || result.successRate >= 0.8) {
          console.log(`[ClassSync] ✅ 表單填寫完成，成功率: ${(result.successRate * 100).toFixed(1)}%`);
          break;
        }

        if (fillAttempts < maxFillAttempts) {
          console.log(
            `[ClassSync] ⚠️ 成功率較低 (${(result.successRate * 100).toFixed(1)}%)，等待後重試...`
          );
          await sleep(800);
        }
      } catch (fillError) {
        console.log(`[ClassSync] 填寫嘗試 ${fillAttempts} 失敗:`, fillError.message);
        if (fillAttempts < maxFillAttempts) {
          await sleep(500);
        }
      }
    }

    if (!fillResult) {
      console.error("[ClassSync] ❌ 所有填寫嘗試都失敗");
      throw new Error("Form filling failed after all attempts");
    }

    if (!fillResult.ok && fillResult.successRate < 0.5) {
      console.error(`[ClassSync] ❌ 表單填寫成功率過低: ${(fillResult.successRate * 100).toFixed(1)}%`);
      console.error("[ClassSync] 錯誤詳情:", fillResult.errors);
      throw new Error(`Form filling success rate too low: ${(fillResult.successRate * 100).toFixed(1)}%`);
    }

    console.log("[ClassSync] 📊 最終填寫結果：", {
      ok: fillResult.ok,
      filledDays: fillResult.filledDays,
      totalDays: fillResult.totalDays,
      successRate: `${(fillResult.successRate * 100).toFixed(1)}%`,
      errorCount: fillResult.errors ? fillResult.errors.length : 0
    });

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
          console.log(
            `[ClassSync] ✅ 成功點擊提交按鈕 (${submitResult.method}): "${submitResult.buttonText}"`
          );
          break;
        }

        if (submitAttempts < maxSubmitAttempts) {
          await sleep(500);
        }
      } catch (submitError) {
        console.log(`[ClassSync] 提交嘗試 ${submitAttempts} 失敗:`, submitError.message);
        if (submitAttempts < maxSubmitAttempts) {
          await sleep(500);
        }
      }
    }

    if (!submitResult || !submitResult.clicked) {
      console.error("[ClassSync] ❌ 無法點擊提交按鈕");
      throw new Error("Unable to click submit button after all attempts");
    }

    console.log("[ClassSync] 步驟 8: 等待提交結果確認...");

    const submissionResult = await waitForSubmissionResult(tabId, 20, 500);
    if (!submissionResult) {
      console.error("[ClassSync] ❌ 提交結果確認超時");
      throw new Error("Submission result confirmation timeout");
    }

    console.log("[ClassSync] 📊 提交結果:", submissionResult);

    if (submissionResult.success) {
      console.log("[ClassSync] 🎉 表單提交成功！自動化流程完成！");
      setProcessRunning(false);
      notifyUI('PROCESS_COMPLETED', { success: true, data: payload });
      if (submissionResult.successMessage) {
        console.log(`[ClassSync] ✅ 成功訊息: "${submissionResult.successMessage}"`);
      }
    } else if (submissionResult.errorMessage) {
      console.error(`[ClassSync] ❌ 提交失敗: ${submissionResult.errorMessage}`);
      setProcessRunning(false);
      notifyUI('PROCESS_ERROR', { error: submissionResult.errorMessage });
      throw new Error(`Submission failed: ${submissionResult.errorMessage}`);
    } else {
      console.warn("[ClassSync] ⚠️ 提交狀態不明確，但流程已完成");
      setProcessRunning(false);
      notifyUI('PROCESS_COMPLETED', { success: true, data: payload });
    }
  } catch (error) {
    console.error("[ClassSync tschoolkit] 執行流程時發生錯誤:", error);

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

    const errorInfo = categorizeError(error);
    setProcessRunning(false);
    notifyUI('PROCESS_ERROR', { error: errorInfo.userMessage });

    throw error;
  }
}
