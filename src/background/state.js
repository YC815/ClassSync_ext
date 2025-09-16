const uiState = {
  isRunning: false
};

export function isProcessRunning() {
  return uiState.isRunning;
}

export function setProcessRunning(isRunning) {
  uiState.isRunning = isRunning;
}

export function notifyUI(type, data = {}) {
  const message = { type, ...data };
  console.log(`[ClassSync UI] 通知 UI: ${type}`, data);

  chrome.runtime.sendMessage(message).catch((error) => {
    console.log(
      `[ClassSync UI] UI 通知失敗 (可能沒有開啟 popup): ${error?.message || error}`
    );
  });
}
