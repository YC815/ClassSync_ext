// content.js - 轉發 window.postMessage 到 background.js
// 這個腳本會在所有頁面上運行，監聽來自網頁的 postMessage

console.log("[ClassSync Content] Content script 已載入於:", window.location.href);

// 監聽網頁發送的 postMessage
window.addEventListener('message', (event) => {
  // 檢查訊息格式
  if (event.data?.type === 'CLASSSYNC_NEXT_WEEK_PAYLOAD') {
    console.log("[ClassSync Content] 收到來自網頁的 postMessage:", event.data);
    // 轉發給 background.js
    chrome.runtime.sendMessage(event.data, (response) => {
      console.log("[ClassSync Content] Background 回應:", response);
      // 將回應發送回網頁
      if (response) {
        window.postMessage({
          type: 'CLASSSYNC_RESPONSE',
          success: response.ok,
          error: response.error
        }, '*');
        console.log("[ClassSync Content] 已回應網頁");
      }
    });
  }
});

// 可選：提供一個全域函數讓網頁直接調用
window.ClassSyncExtension = {
  sendPayload: (payload) => {
    console.log("[ClassSync Content] ClassSyncExtension.sendPayload 被調用:", payload);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'CLASSSYNC_NEXT_WEEK_PAYLOAD',
        payload
      }, (response) => {
        console.log("[ClassSync Content] ClassSyncExtension 收到回應:", response);
        if (response?.ok) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Unknown error'));
        }
      });
    });
  },

  // 檢查擴充功能是否可用
  isAvailable: () => {
    const available = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
    console.log("[ClassSync Content] 擴充功能可用性檢查:", available);
    return available;
  }
};

console.log("[ClassSync Content] ClassSyncExtension 全域物件已建立");