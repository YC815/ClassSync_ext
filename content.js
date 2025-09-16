// content.js - 內容腳本，處理頁面交互和 token 管理
console.log('[ClassSync] content.js 開始載入');

// 全域變數
let latestIdToken = null;
let pageInfo = null;

// 注入 page-level 腳本
function injectPageScript() {
  console.log('[ClassSync] 開始注入 page-inject.js');
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-inject.js');
    script.type = 'text/javascript';
    script.onload = () => {
      console.log('[ClassSync] page-inject.js 注入成功');
      script.remove();
    };
    script.onerror = (error) => {
      console.error('[ClassSync] page-inject.js 注入失敗:', error);
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    console.error('[ClassSync] 注入腳本時發生錯誤:', error);
  }
}

// 接收來自 page-inject.js 的訊息
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  console.log('[ClassSync] 收到 postMessage:', {
    type: event.data?.type,
    source: event.data?.source,
    hasToken: !!event.data?.idToken,
    tokenLength: event.data?.idToken?.length || 0
  });

  if (event.data?.type === 'CLASSSYNC_ID_TOKEN') {
    latestIdToken = event.data.idToken;
    if (latestIdToken) {
      console.log('[ClassSync] 已更新 latestIdToken, 長度:', latestIdToken.length);
    } else {
      console.log('[ClassSync] page-inject 未能獲取 token，將使用後備方案');
    }
  }
});

// IndexedDB 後備方案 - 直接讀取 Firebase 的 IndexedDB
async function getTokenFromIndexedDBFallback() {
  console.log('[ClassSync] 開始 IndexedDB 後備方案');
  try {
    // 開啟 Firebase IndexedDB
    const dbRequest = indexedDB.open('firebaseLocalStorageDb');
    const db = await new Promise((resolve, reject) => {
      dbRequest.onerror = () => {
        console.error('[ClassSync] 無法開啟 firebaseLocalStorageDb:', dbRequest.error);
        reject(dbRequest.error);
      };
      dbRequest.onsuccess = () => {
        console.log('[ClassSync] 成功開啟 firebaseLocalStorageDb');
        resolve(dbRequest.result);
      };
    });

    console.log('[ClassSync] DB object stores:', Array.from(db.objectStoreNames));

    // 檢查是否有 firebaseLocalStorage store
    if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
      console.log('[ClassSync] 沒有找到 firebaseLocalStorage store');
      db.close();
      return null;
    }

    // 讀取所有記錄
    const transaction = db.transaction(['firebaseLocalStorage'], 'readonly');
    const store = transaction.objectStore('firebaseLocalStorage');

    const records = await new Promise((resolve, reject) => {
      const getAllRequest = store.getAll ? store.getAll() : null;

      if (getAllRequest) {
        getAllRequest.onerror = () => reject(getAllRequest.error);
        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
      } else {
        // 如果不支援 getAll，使用 cursor
        const items = [];
        const cursorRequest = store.openCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            items.push(cursor.value);
            cursor.continue();
          } else {
            resolve(items);
          }
        };
      }
    });

    console.log('[ClassSync] 找到', records.length, '條 IndexedDB 記錄');

    // 搜尋包含 token 的記錄
    for (const record of records) {
      console.log('[ClassSync] 檢查記錄:', {
        key: record.fbase_key,
        hasValue: !!record.value,
        valueType: typeof record.value
      });

      if (record.value && typeof record.value === 'object') {
        // 檢查是否有 stsTokenManager
        const stsToken = record.value.stsTokenManager;
        if (stsToken && stsToken.accessToken) {
          console.log('[ClassSync] 在 IndexedDB 中找到 accessToken');
          console.log('[ClassSync] Token 長度:', stsToken.accessToken.length);
          console.log('[ClassSync] Token 過期時間:', new Date(parseInt(stsToken.expirationTime)));

          db.close();
          return stsToken.accessToken;
        }
      }
    }

    console.log('[ClassSync] IndexedDB 中沒有找到 accessToken');
    db.close();
    return null;

  } catch (error) {
    console.error('[ClassSync] IndexedDB 後備方案失敗:', error);
    return null;
  }
}

// 收集頁面信息
async function collectPageInfo() {
  console.log('[ClassSync] 開始收集頁面信息');

  try {
    const info = {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now()
    };

    // 嘗試從頁面 DOM 收集信息
    console.log('[ClassSync] 頁面基本信息:', info);

    // 檢查是否在週曆頁面
    const isCalendarPage = window.location.href.includes('calendar') ||
                          document.title.includes('週曆') ||
                          document.querySelector('[data-testid*="calendar"]') ||
                          document.querySelector('.calendar');

    console.log('[ClassSync] 是否為週曆頁面:', isCalendarPage);

    // 嘗試獲取用戶信息
    const userElements = document.querySelectorAll('[class*="user"], [class*="name"], [data-testid*="user"]');
    console.log('[ClassSync] 找到', userElements.length, '個可能的用戶元素');

    // 嘗試從 localStorage 獲取用戶信息
    const userInfo = {};
    for (const key of Object.keys(localStorage)) {
      if (key.includes('user') || key.includes('profile') || key.includes('auth')) {
        try {
          const value = JSON.parse(localStorage.getItem(key));
          if (value && typeof value === 'object') {
            console.log('[ClassSync] localStorage 用戶相關資料:', key, Object.keys(value));
            if (value.email) userInfo.email = value.email;
            if (value.name || value.displayName) userInfo.name = value.name || value.displayName;
            if (value.uid) userInfo.uid = value.uid;
          }
        } catch (e) {
          // 忽略 JSON 解析錯誤
        }
      }
    }

    info.userInfo = userInfo;
    info.isCalendarPage = isCalendarPage;
    pageInfo = info;

    console.log('[ClassSync] 頁面信息收集完成:', pageInfo);
    return info;

  } catch (error) {
    console.error('[ClassSync] 收集頁面信息時發生錯誤:', error);
    return null;
  }
}

// 處理來自 background.js 的請求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ClassSync] 收到來自 background 的訊息:', message);

  if (message.action === 'GET_ID_TOKEN') {
    (async () => {
      console.log('[ClassSync] 開始處理 GET_ID_TOKEN 請求');

      // 如果沒有 token，嘗試後備方案
      if (!latestIdToken) {
        console.log('[ClassSync] 沒有快取的 token，嘗試 IndexedDB 後備方案');
        latestIdToken = await getTokenFromIndexedDBFallback();
      }

      const response = {
        success: !!latestIdToken,
        idToken: latestIdToken,
        timestamp: Date.now()
      };

      console.log('[ClassSync] 回應 GET_ID_TOKEN:', {
        success: response.success,
        hasToken: !!response.idToken,
        tokenLength: response.idToken?.length || 0
      });

      sendResponse(response);
    })();
    return true; // 表示會以異步方式回應
  }

  if (message.action === 'GET_PAGE_INFO') {
    (async () => {
      console.log('[ClassSync] 開始處理 GET_PAGE_INFO 請求');

      if (!pageInfo) {
        await collectPageInfo();
      }

      const response = {
        success: !!pageInfo,
        pageInfo: pageInfo
      };

      console.log('[ClassSync] 回應 GET_PAGE_INFO:', response);
      sendResponse(response);
    })();
    return true; // 表示會以異步方式回應
  }

  if (message.action === 'REFRESH_TOKEN') {
    console.log('[ClassSync] 收到 REFRESH_TOKEN 請求，重新注入腳本');
    latestIdToken = null;
    injectPageScript();
    sendResponse({ success: true });
  }
});

// 初始化
(async () => {
  console.log('[ClassSync] content.js 初始化開始');

  // 等待 DOM 準備就緒
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[ClassSync] DOM 載入完成');
    });
  }

  // 注入 page script
  injectPageScript();

  // 收集頁面信息
  await collectPageInfo();

  // ==================== 浮動 UI 功能 ====================

// 創建浮動UI
function createFloatingUI() {
  console.log('[ClassSync] 開始創建浮動UI');

  // 檢查是否已存在
  if (document.getElementById('classsync-floating-ui')) {
    console.log('[ClassSync] 浮動UI已存在，跳過創建');
    return;
  }

  // 創建容器
  const container = document.createElement('div');
  container.id = 'classsync-floating-ui';

  // 使用Shadow DOM隔離樣式
  const shadowRoot = container.attachShadow({ mode: 'closed' });

  // CSS樣式
  const style = document.createElement('style');
  style.textContent = `
    .classsync-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .classsync-button {
      background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
      border: none;
      color: white;
      padding: 12px 20px;
      border-radius: 25px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .classsync-button:hover {
      background: linear-gradient(135deg, #45a049 0%, #4CAF50 100%);
      box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
      transform: translateY(-2px);
    }

    .classsync-button:active {
      transform: translateY(0);
      box-shadow: 0 2px 10px rgba(76, 175, 80, 0.3);
    }

    .classsync-button:disabled {
      background: #cccccc;
      cursor: not-allowed;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transform: none;
    }

    .classsync-icon {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }

    .classsync-panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 320px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
      z-index: 10001;
      display: none;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .classsync-panel-header {
      padding: 20px;
      border-bottom: 1px solid #eee;
    }

    .classsync-panel-title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #333;
    }

    .classsync-panel-subtitle {
      margin: 4px 0 0 0;
      font-size: 14px;
      color: #666;
    }

    .classsync-panel-body {
      padding: 20px;
    }

    .classsync-panel-button {
      width: 100%;
      background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
      border: none;
      color: white;
      padding: 14px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .classsync-panel-button:hover {
      background: linear-gradient(135deg, #45a049 0%, #4CAF50 100%);
    }

    .classsync-panel-button:disabled {
      background: #cccccc;
      cursor: not-allowed;
    }

    .classsync-close-btn {
      position: absolute;
      top: 15px;
      right: 15px;
      background: none;
      border: none;
      font-size: 20px;
      color: #999;
      cursor: pointer;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.2s ease;
    }

    .classsync-close-btn:hover {
      background: #f5f5f5;
      color: #333;
    }
  `;

  // HTML結構
  const html = `
    <div class="classsync-container">
      <!-- 浮動按鈕 -->
      <button class="classsync-button" id="classsync-toggle-btn">
        <svg class="classsync-icon" viewBox="0 0 24 24">
          <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2a1 1 0 0 0-2 0v2H8V2a1 1 0 0 0-2 0v2H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zM4 7a1 1 0 0 1 1-1h1v1a1 1 0 0 0 2 0V6h8v1a1 1 0 0 0 2 0V6h1a1 1 0 0 1 1 1v2H4V7zm16 13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9h16v9z"/>
        </svg>
        週曆填報
      </button>

      <!-- 面板 -->
      <div class="classsync-panel" id="classsync-panel">
        <button class="classsync-close-btn" id="classsync-close-btn">×</button>
        <div class="classsync-panel-header">
          <h3 class="classsync-panel-title">ClassSync</h3>
          <p class="classsync-panel-subtitle">一鍵填報週曆</p>
        </div>
        <div class="classsync-panel-body">
          <button class="classsync-panel-button" id="classsync-fill-btn">開始填報</button>
        </div>
      </div>
    </div>
  `;

  // 添加樣式和HTML到Shadow DOM
  shadowRoot.appendChild(style);
  shadowRoot.innerHTML += html;

  // 添加事件監聽器
  const toggleBtn = shadowRoot.getElementById('classsync-toggle-btn');
  const panel = shadowRoot.getElementById('classsync-panel');
  const closeBtn = shadowRoot.getElementById('classsync-close-btn');
  const fillBtn = shadowRoot.getElementById('classsync-fill-btn');

  // 切換面板顯示
  toggleBtn.addEventListener('click', () => {
    const isVisible = panel.style.display === 'block';
    panel.style.display = isVisible ? 'none' : 'block';
  });

  // 關閉面板
  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // 點擊外部關閉面板
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      panel.style.display = 'none';
    }
  });

  // 填報按鈕點擊
  fillBtn.addEventListener('click', async () => {
    console.log('[ClassSync] 浮動UI填報按鈕被點擊');

    fillBtn.disabled = true;
    fillBtn.textContent = '填報中...';

    try {
      // 直接調用background script執行填報流程
      const response = await chrome.runtime.sendMessage({
        action: 'START_FILL_PROCESS_FROM_UI'
      });

      if (response && response.success) {
        fillBtn.textContent = '✅ 填報成功';
        setTimeout(() => {
          fillBtn.textContent = '開始填報';
          fillBtn.disabled = false;
          panel.style.display = 'none';
        }, 2000);
      } else {
        fillBtn.textContent = '❌ 填報失敗';
        console.error('[ClassSync] 填報失敗:', response?.error);
        setTimeout(() => {
          fillBtn.textContent = '開始填報';
          fillBtn.disabled = false;
        }, 2000);
      }
    } catch (error) {
      console.error('[ClassSync] 填報過程中發生錯誤:', error);
      fillBtn.textContent = '❌ 發生錯誤';
      setTimeout(() => {
        fillBtn.textContent = '開始填報';
        fillBtn.disabled = false;
      }, 2000);
    }
  });

  // 將容器添加到頁面
  document.body.appendChild(container);
  console.log('[ClassSync] 浮動UI創建完成');
}

// 在頁面載入完成後創建浮動UI
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFloatingUI);
} else {
  createFloatingUI();
}

console.log('[ClassSync] content.js 初始化完成');
})();