import { startFlow } from "./automation/flow.js";
import { notifyUI, isProcessRunning, setProcessRunning } from "./state.js";
import { validatePayload, setCachedPayload } from "./payload.js";
import { categorizeError } from "./errors.js";

function launchFlow() {
  if (isProcessRunning()) {
    console.log("[ClassSync] 自動化流程已在執行中");
    return;
  }

  setProcessRunning(true);
  notifyUI('PROCESS_STARTED');

  startFlow().catch((error) => {
    console.error("[ClassSync] 自動化流程失敗:", error);
    setProcessRunning(false);
    const errorInfo = categorizeError(error);
    notifyUI('PROCESS_ERROR', { error: errorInfo.userMessage });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) {
    return false;
  }

  if (msg.type === 'START_CLASSSYNC') {
    launchFlow();
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === 'STOP_CLASSSYNC') {
    setProcessRunning(false);
    notifyUI('PROCESS_COMPLETED', { success: false });
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === 'PING') {
    sendResponse?.({ ok: true, isRunning: isProcessRunning() });
    return true;
  }

  if (msg.type === 'CLASSSYNC_NEXT_WEEK_PAYLOAD') {
    (async () => {
      if (!validatePayload(msg.payload)) {
        console.error("[ClassSync] Payload 驗證失敗:", msg.payload);
        sendResponse?.({ ok: false, error: 'Invalid payload schema' });
        return;
      }

      console.log("[ClassSync] 收到外部 payload:", msg.payload);
      await setCachedPayload(msg.payload);
      sendResponse?.({ ok: true });

      if (!isProcessRunning()) {
        launchFlow();
      }
    })().catch((error) => {
      console.error("[ClassSync] 儲存 payload 發生錯誤:", error);
      sendResponse?.({ ok: false, error: error.message });
    });

    return true;
  }

  return false;
});

chrome.runtime.onMessageExternal?.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'CLASSSYNC_NEXT_WEEK_PAYLOAD') {
    return;
  }

  if (!validatePayload(msg.payload)) {
    console.error("[ClassSync] 外部網域 Payload 驗證失敗:", msg.payload);
    sendResponse?.({ ok: false, error: 'Invalid payload schema' });
    return;
  }

  console.log("[ClassSync] 收到外部網域 payload:", msg.payload);
  setCachedPayload(msg.payload)
    .then(() => {
      sendResponse?.({ ok: true });
      if (!isProcessRunning()) {
        launchFlow();
      }
    })
    .catch((error) => {
      console.error("[ClassSync] 儲存外部 payload 發生錯誤:", error);
      sendResponse?.({ ok: false, error: error.message });
    });

  return true;
});

chrome.action.onClicked.addListener(() => {
  console.log("[ClassSync] 📱 擴充功能圖示被點擊，準備執行流程");
  launchFlow();
});
