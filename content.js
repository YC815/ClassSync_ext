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

  console.log('[ClassSync] content.js 初始化完成');
})();