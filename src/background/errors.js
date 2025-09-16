export function categorizeError(error) {
  const message = error.message || error.toString();
  const messageLower = message.toLowerCase();

  let category = 'unknown';
  let userMessage = '發生未知錯誤，請重試';
  let suggestions = [];

  if (messageLower.includes('login') || messageLower.includes('登入')) {
    category = 'authentication';
    userMessage = '需要登入 1Campus';
    suggestions = ['請先登入 1Campus', '確認登入狀態正常'];
  } else if (messageLower.includes('page') || messageLower.includes('載入') || messageLower.includes('ready')) {
    category = 'page_load';
    userMessage = '頁面載入失敗';
    suggestions = ['重新整理頁面', '檢查網路連線', '稍後重試'];
  } else if (messageLower.includes('click') || messageLower.includes('學習週曆') || messageLower.includes('element')) {
    category = 'element_not_found';
    userMessage = '找不到學習週曆按鈕';
    suggestions = ['確認頁面已完全載入', '檢查是否在正確的頁面', '嘗試手動點擊一次'];
  } else if (messageLower.includes('tschoolkit') || messageLower.includes('新分頁') || messageLower.includes('tab')) {
    category = 'tab_navigation';
    userMessage = 'tschoolkit 頁面開啟失敗';
    suggestions = ['檢查網路連線', '確認 tschoolkit 網站可正常訪問', '關閉其他不必要的分頁'];
  } else if (messageLower.includes('modal') || messageLower.includes('form') || messageLower.includes('表單')) {
    category = 'form_access';
    userMessage = '無法開啟週曆填報表單';
    suggestions = ['手動點擊「週曆填報」按鈕', '確認頁面沒有彈出視窗阻擋', '重新載入 tschoolkit 頁面'];
  } else if (messageLower.includes('fill') || messageLower.includes('填寫') || messageLower.includes('custom') || messageLower.includes('自訂')) {
    category = 'form_filling';
    userMessage = '表單填寫失敗';
    suggestions = ['檢查週曆資料格式', '確認所有必填欄位都有資料', '手動檢查並完成填寫'];
  } else if (messageLower.includes('submit') || messageLower.includes('提交') || messageLower.includes('送出')) {
    category = 'submission';
    userMessage = '提交失敗';
    suggestions = ['檢查網路連線', '確認表單資料完整', '嘗試手動提交'];
  } else if (messageLower.includes('timeout') || messageLower.includes('超時')) {
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
