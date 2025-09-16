// background.js - 服務工作者，處理 API 調用和主要邏輯
console.log('[ClassSync] background.js 載入');

// 初始化設定
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ClassSync] 擴充功能已安裝');
});

// API 端點
const TSCHOOL_API = 'https://asia-east1-campus-lite.cloudfunctions.net/tschool/setCalendar';
const NEXT_API_PAYLOAD = 'https://cst.zeabur.app/api/tschool/payload';

// API 密鑰 - 固定值
const API_SECRET = 'p8iaUz1YruM+5xVLKGevE7pb2eHx1qeYTmeQyMsXVLSyL1Lmohj38r66yqeoKuhX';

// 測試用的預設週曆資料
const DEFAULT_CALENDAR_DATA = {
  locations: ['弘道基地', '吉林基地', '在家中'], // 可選地點
  defaultSchedule: {
    am: '弘道基地',
    pm: '弘道基地'
  }
};

// 生成週曆資料的輔助函數
function generateWeeklySchedule(weekStartDate, schedule = DEFAULT_CALENDAR_DATA.defaultSchedule) {
  console.log('[ClassSync] 生成週曆資料，起始日期:', weekStartDate);

  const weekData = {};
  const startDate = new Date(weekStartDate);

  // 生成一週的資料（週一到週五）
  for (let i = 0; i < 5; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD 格式

    weekData[dateStr] = {
      am: schedule.am,
      pm: schedule.pm
    };

    console.log('[ClassSync] 設定', dateStr, ':', weekData[dateStr]);
  }

  return weekData;
}

// 計算週次的輔助函數
function calculateWeekNumber(date = new Date()) {
  console.log('[ClassSync] 計算週次，日期:', date);

  // 簡單的週次計算 - 可能需要根據學校的週次系統調整
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil(dayOfYear / 7);

  console.log('[ClassSync] 計算得出週次:', weekNumber);
  return weekNumber;
}

// 獲取下週一的日期
function getNextMondayOfWeek(date = new Date()) {
  const d = new Date(date);
  const dayOfWeek = d.getDay();
  const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // 調整到週一
  const monday = new Date(d.setDate(diff));

  // 加 7 天得到下週一
  monday.setDate(monday.getDate() + 7);

  console.log('[ClassSync] 下週週一:', monday.toISOString().split('T')[0]);
  return monday;
}

// 從 Next.js API 取得組好的 payload
async function fetchPayloadFromAPI(userData = {}) {
  const nextMonday = getNextMondayOfWeek();
  const weekNumber = calculateWeekNumber(nextMonday);
  const weekStartISO = nextMonday.toISOString().split('T')[0];

  // 構建查詢參數
  const params = new URLSearchParams({
    week: weekNumber.toString(),
    weekStartISO: weekStartISO,
    ...(userData.email && { userEmail: userData.email })
  });

  const payloadUrl = `${NEXT_API_PAYLOAD}?${params}`;

  console.log('[ClassSync] 從 Next.js API 取得 payload:', payloadUrl);

  try {
    const response = await fetch(payloadUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 錯誤 ${response.status}: ${response.statusText}\n${errorText}`);
    }

    const payload = await response.json();
    console.log('[ClassSync] 成功取得 payload:', {
      id: payload.id,
      week: payload.week,
      email: payload.email,
      dateKeys: Object.keys(payload).filter(key => key.match(/^\d{4}-\d{2}-\d{2}$/))
    });

    return payload;

  } catch (error) {
    console.error('[ClassSync] 無法從 Next.js API 取得 payload:', error);
    throw new Error(`無法取得週曆資料: ${error.message}`);
  }
}

// 主要的 API 調用函數
async function submitCalendar(idToken, userData = {}) {
  console.log('[ClassSync] === 開始提交週曆 ===');
  console.log('[ClassSync] idToken 長度:', idToken?.length || 0);
  console.log('[ClassSync] 用戶資料:', userData);

  try {
    // 1. 從 Next.js API 取得組裝好的 payload
    console.log('[ClassSync] 步驟 1: 從 Next.js API 取得 payload');
    const payloadData = await fetchPayloadFromAPI(userData);

    // 2. 構建最終的 setCalendar 請求體
    const finalPayload = {
      idToken: idToken,
      data: {
        ...payloadData,
        timestamp: Date.now() // 更新送出時間
      },
      nextWeek: true
    };

    console.log('[ClassSync] 構建最終 payload:', {
      hasIdToken: !!finalPayload.idToken,
      idTokenLength: finalPayload.idToken?.length || 0,
      dataKeys: Object.keys(finalPayload.data),
      payloadId: finalPayload.data.id,
      nextWeek: finalPayload.nextWeek
    });

    // 3. 送出 API 請求到 setCalendar
    console.log('[ClassSync] 步驟 2: 送出到 setCalendar API:', TSCHOOL_API);

    const response = await fetch(TSCHOOL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(finalPayload)
    });

    console.log('[ClassSync] API 回應狀態:', response.status, response.statusText);
    console.log('[ClassSync] API 回應 headers:', Object.fromEntries(response.headers.entries()));

    // 處理回應
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[ClassSync] API 錯誤回應:', errorText);
      throw new Error(`API 錯誤: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result = await response.json().catch(async () => {
      const text = await response.text();
      console.log('[ClassSync] 非 JSON 回應:', text);
      return { success: true, rawResponse: text };
    });

    console.log('[ClassSync] API 成功回應:', result);
    return { success: true, data: result };

  } catch (error) {
    console.error('[ClassSync] 提交週曆失敗:', error);
    return { success: false, error: error.message };
  }
}


// 執行填報流程的函數（從原來的 action.onClicked 邏輯移過來）
async function executeFillProcess(tabId) {
  console.log('[ClassSync] === 開始執行填報流程 ===');

  try {
    // 1. 獲取頁面信息
    console.log('[ClassSync] 步驟 1: 獲取頁面信息');
    const pageInfoResponse = await chrome.tabs.sendMessage(tabId, { action: 'GET_PAGE_INFO' });
    console.log('[ClassSync] 頁面信息回應:', pageInfoResponse);

    // 2. 獲取 idToken
    console.log('[ClassSync] 步驟 2: 獲取 idToken');
    const tokenResponse = await chrome.tabs.sendMessage(tabId, { action: 'GET_ID_TOKEN' });
    console.log('[ClassSync] Token 回應:', {
      success: tokenResponse?.success,
      hasToken: !!tokenResponse?.idToken,
      tokenLength: tokenResponse?.idToken?.length || 0
    });

    if (!tokenResponse?.success || !tokenResponse?.idToken) {
      console.error('[ClassSync] 無法獲取 idToken');

      // 嘗試刷新 token
      console.log('[ClassSync] 嘗試刷新 token');
      await chrome.tabs.sendMessage(tabId, { action: 'REFRESH_TOKEN' });

      // 等待一下再重試
      await new Promise(resolve => setTimeout(resolve, 2000));
      const retryTokenResponse = await chrome.tabs.sendMessage(tabId, { action: 'GET_ID_TOKEN' });

      if (!retryTokenResponse?.success || !retryTokenResponse?.idToken) {
        throw new Error('無法獲取有效的 idToken，請確保已登入 tschoolkit.web.app');
      }

      console.log('[ClassSync] 重試後成功獲取 token');
    }

    // 3. 提交週曆
    console.log('[ClassSync] 步驟 3: 提交週曆');
    const submitResult = await submitCalendar(
      tokenResponse.idToken,
      pageInfoResponse?.pageInfo?.userInfo || {}
    );

    console.log('[ClassSync] 提交結果:', submitResult);

    // 4. 顯示結果
    if (submitResult.success) {
      console.log('[ClassSync] ✅ 週曆提交成功！');

      // 通知用戶
      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-48.png',
          title: 'ClassSync',
          message: '週曆提交成功！'
        });
      }
      return { success: true };
    } else {
      console.error('[ClassSync] ❌ 週曆提交失敗:', submitResult.error);

      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-48.png',
          title: 'ClassSync',
          message: `週曆提交失敗: ${submitResult.error}`
        });
      }
      return { success: false, error: submitResult.error };
    }

  } catch (error) {
    console.error('[ClassSync] 主要流程執行失敗:', error);

    if (chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'ClassSync',
        message: `執行失敗: ${error.message}`
      });
    }
    return { success: false, error: error.message };
  }
}

// 監聽來自其他腳本的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ClassSync] background 收到訊息:', message, '來自:', sender);

  // 處理浮動UI的填報請求
  if (message.action === 'START_FILL_PROCESS_FROM_UI') {
    console.log('[ClassSync] 處理浮動UI的填報請求');

    // 獲取當前活動的tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('tschoolkit.web.app')) {
        // 執行填報流程
        executeFillProcess(tabs[0].id)
          .then(result => {
            console.log('[ClassSync] 填報流程完成:', result);
            sendResponse(result);
          })
          .catch(error => {
            console.error('[ClassSync] 填報流程失敗:', error);
            sendResponse({ success: false, error: error.message });
          });
      } else {
        console.error('[ClassSync] 不在正確的網站上');
        sendResponse({ success: false, error: '請確保在 tschoolkit.web.app 網站上' });
      }
    });

    // 返回 true 表示異步回應
    return true;
  }

  // 處理帶有tabId的填報請求（向後兼容）
  if (message.action === 'START_FILL_PROCESS' && message.tabId) {
    console.log('[ClassSync] 處理指定tab的填報請求');

    // 執行填報流程
    executeFillProcess(message.tabId)
      .then(result => {
        console.log('[ClassSync] 填報流程完成:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[ClassSync] 填報流程失敗:', error);
        sendResponse({ success: false, error: error.message });
      });

    // 返回 true 表示異步回應
    return true;
  }

  sendResponse({ received: true });
});

console.log('[ClassSync] background.js 初始化完成');