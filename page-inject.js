// page-inject.js - 在頁面環境中運行，獲取 Firebase idToken
(async () => {
  console.log('[ClassSync] page-inject.js 開始執行');

  // 等待頁面完全載入
  const waitForPageReady = () => {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve);
      }
    });
  };

  await waitForPageReady();
  console.log('[ClassSync] 頁面載入完成，開始尋找 Firebase');

  // 檢查可能的 Firebase 實例
  console.log('[ClassSync] 檢查全域變數:', {
    firebase: typeof window.firebase,
    firebaseAuth: typeof window.firebaseAuth,
    getAuth: typeof window.getAuth,
    __firebase_auth_instance__: typeof window.__firebase_auth_instance__
  });

  // 方法1：嘗試使用傳統的 Firebase v8/v9 API
  async function tryGetTokenFromFirebase() {
    try {
      console.log('[ClassSync] 嘗試方法1：傳統 Firebase API');

      // 檢查 Firebase v8 格式
      if (window.firebase && window.firebase.auth) {
        console.log('[ClassSync] 發現 Firebase v8 實例');
        const auth = window.firebase.auth();
        const currentUser = auth.currentUser;
        console.log('[ClassSync] 當前用戶:', currentUser?.email || 'null');

        if (currentUser) {
          console.log('[ClassSync] 嘗試獲取 idToken (v8)');
          const token = await currentUser.getIdToken(true);
          console.log('[ClassSync] 成功獲取 idToken (v8), 長度:', token?.length);
          return token;
        }
      }

      // 檢查 Firebase v9 格式
      if (window.getAuth) {
        console.log('[ClassSync] 發現 Firebase v9 getAuth');
        const auth = window.getAuth();
        const currentUser = auth.currentUser;
        console.log('[ClassSync] v9 當前用戶:', currentUser?.email || 'null');

        if (currentUser) {
          console.log('[ClassSync] 嘗試獲取 idToken (v9)');
          const token = await currentUser.getIdToken(true);
          console.log('[ClassSync] 成功獲取 idToken (v9), 長度:', token?.length);
          return token;
        }
      }

      // 檢查其他可能的 Firebase 實例
      if (window.firebaseAuth) {
        console.log('[ClassSync] 發現 firebaseAuth 實例');
        const currentUser = window.firebaseAuth.currentUser;
        console.log('[ClassSync] firebaseAuth 當前用戶:', currentUser?.email || 'null');

        if (currentUser) {
          console.log('[ClassSync] 嘗試獲取 idToken (firebaseAuth)');
          const token = await currentUser.getIdToken(true);
          console.log('[ClassSync] 成功獲取 idToken (firebaseAuth), 長度:', token?.length);
          return token;
        }
      }

      console.log('[ClassSync] 所有 Firebase API 方法都失敗');
      return null;
    } catch (error) {
      console.error('[ClassSync] Firebase API 獲取 token 失敗:', error);
      return null;
    }
  }

  // 方法2：嘗試從 localStorage 獲取
  function tryGetTokenFromLocalStorage() {
    console.log('[ClassSync] 嘗試方法2：localStorage');
    try {
      const keys = Object.keys(localStorage);
      console.log('[ClassSync] localStorage keys:', keys.filter(k => k.includes('firebase')));

      for (const key of keys) {
        if (key.includes('firebase') && key.includes('user')) {
          const value = localStorage.getItem(key);
          console.log('[ClassSync] 檢查 localStorage key:', key, 'value length:', value?.length);

          try {
            const parsed = JSON.parse(value);
            if (parsed.stsTokenManager && parsed.stsTokenManager.accessToken) {
              console.log('[ClassSync] 在 localStorage 中找到 accessToken');
              return parsed.stsTokenManager.accessToken;
            }
          } catch (e) {
            console.log('[ClassSync] 解析 localStorage 值失敗:', key);
          }
        }
      }

      console.log('[ClassSync] localStorage 方法失敗');
      return null;
    } catch (error) {
      console.error('[ClassSync] localStorage 獲取失敗:', error);
      return null;
    }
  }

  // 方法3：嘗試從 sessionStorage 獲取
  function tryGetTokenFromSessionStorage() {
    console.log('[ClassSync] 嘗試方法3：sessionStorage');
    try {
      const keys = Object.keys(sessionStorage);
      console.log('[ClassSync] sessionStorage keys:', keys.filter(k => k.includes('firebase')));

      for (const key of keys) {
        if (key.includes('firebase')) {
          const value = sessionStorage.getItem(key);
          console.log('[ClassSync] 檢查 sessionStorage key:', key, 'value length:', value?.length);

          try {
            const parsed = JSON.parse(value);
            if (parsed.stsTokenManager && parsed.stsTokenManager.accessToken) {
              console.log('[ClassSync] 在 sessionStorage 中找到 accessToken');
              return parsed.stsTokenManager.accessToken;
            }
          } catch (e) {
            console.log('[ClassSync] 解析 sessionStorage 值失敗:', key);
          }
        }
      }

      console.log('[ClassSync] sessionStorage 方法失敗');
      return null;
    } catch (error) {
      console.error('[ClassSync] sessionStorage 獲取失敗:', error);
      return null;
    }
  }

  // 主要邏輯：按順序嘗試不同方法
  let token = null;

  console.log('[ClassSync] === 開始 Token 獲取流程 ===');

  // 優先嘗試 Firebase API
  token = await tryGetTokenFromFirebase();

  if (!token) {
    // 備用方案1：localStorage
    token = tryGetTokenFromLocalStorage();
  }

  if (!token) {
    // 備用方案2：sessionStorage
    token = tryGetTokenFromSessionStorage();
  }

  // 回報結果
  console.log('[ClassSync] === Token 獲取結果 ===');
  console.log('[ClassSync] Token 獲取狀態:', token ? '成功' : '失敗');
  if (token) {
    console.log('[ClassSync] Token 長度:', token.length);
    console.log('[ClassSync] Token 前50字元:', token.substring(0, 50));
  }

  // 透過 postMessage 傳回 content script
  window.postMessage({
    type: 'CLASSSYNC_ID_TOKEN',
    idToken: token,
    timestamp: Date.now(),
    source: 'page-inject'
  }, '*');

  console.log('[ClassSync] page-inject.js 執行完成，已傳送 postMessage');
})();