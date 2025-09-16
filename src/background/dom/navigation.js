export function check1CampusPageStatus() {
  console.log("[ClassSync Check] 檢查 1Campus 頁面狀態...");

  const result = {
    url: window.location.href,
    title: document.title,
    isLoginPage: false,
    hasError: false,
    errorMessage: "",
    hasSchoolButton: false,
    hasLearningCalendar: false
  };

  const loginIndicators = [
    'input[type="password"]',
    'form[action*="login"]',
    'button[type="submit"]',
    '.login-form',
    '#login'
  ];

  for (const selector of loginIndicators) {
    if (document.querySelector(selector)) {
      result.isLoginPage = true;
      break;
    }
  }

  const errorSelectors = ['.error', '.alert-danger', '.message.error', '.alert-error'];

  for (const selector of errorSelectors) {
    const errorEl = document.querySelector(selector);
    if (errorEl && errorEl.textContent.trim()) {
      const errorText = errorEl.textContent.trim();
      if (!['刪除', '編輯', '新增', '確定', '取消'].includes(errorText) && errorText.length > 2) {
        result.hasError = true;
        result.errorMessage = errorText;
        break;
      }
    }
  }

  const schoolButton = document.querySelector('button.btn.btn-sm.rounded-full.w-14.btn-ghost');
  result.hasSchoolButton = !!schoolButton;

  const learningCalendarImg = document.querySelector('img[alt="學習週曆"]');
  const learningCalendarText = Array.from(document.querySelectorAll('*')).find((el) =>
    el.textContent?.includes("學習週曆")
  );
  result.hasLearningCalendar = !!(learningCalendarImg || learningCalendarText);

  console.log("[ClassSync Check] 頁面狀態檢查結果:", result);
  return result;
}

export function clickLearningCalendarCard() {
  console.log("[ClassSync Click] 開始智能搜尋「學習週曆」相關元素...");
  console.log("[ClassSync Click] 當前頁面URL:", window.location.href);
  console.log("[ClassSync Click] 頁面載入狀態:", document.readyState);

  const startTime = Date.now();

  const searchStrategies = [
    () => {
      const img = document.querySelector('img[alt="學習週曆"]');
      if (img) {
        const clickable = img.closest(
          '[role="button"], a, button, div[onclick], [data-click], .clickable, .card, .item, .tile'
        );
        if (clickable && clickable.offsetWidth > 0 && clickable.offsetHeight > 0) {
          console.log("[ClassSync Click] ✅ 策略1成功: 找到學習週曆圖片的可點擊父元素");
          return clickable;
        }
        if (img.offsetWidth > 0 && img.offsetHeight > 0) {
          console.log("[ClassSync Click] ✅ 策略1備用: 直接點擊學習週曆圖片");
          return img;
        }
      }
      return null;
    },
    () => {
      const textElements = Array.from(document.querySelectorAll('a, button, [role="button"], div, span'));
      const exactMatch = textElements.find((el) => {
        const text = (el.textContent || "").trim();
        return text === "學習週曆" && el.offsetWidth > 0 && el.offsetHeight > 0;
      });
      if (exactMatch) {
        console.log("[ClassSync Click] ✅ 策略2成功: 找到精確文字匹配的元素");
        return exactMatch;
      }
      return null;
    },
    () => {
      const clickableElements = Array.from(
        document.querySelectorAll('a, button, [role="button"], div[onclick], [data-click], .card, .item, .tile, .btn, .clickable')
      );
      const textMatch = clickableElements.find((el) => {
        const text = (el.textContent || "").trim();
        return text.includes("學習週曆") && el.offsetWidth > 0 && el.offsetHeight > 0;
      });
      if (textMatch) {
        console.log("[ClassSync Click] ✅ 策略3成功: 找到包含學習週曆文字的可點擊元素");
        return textMatch;
      }
      return null;
    },
    () => {
      const clickableElements = Array.from(
        document.querySelectorAll('a, button, [role="button"], div[onclick], [data-click], .card, .item, .tile, .btn')
      );
      const partialMatch = clickableElements.find((el) => {
        const text = (el.textContent || "").trim().toLowerCase();
        return (
          (text.includes("學習") || text.includes("週曆") || text.includes("calendar")) &&
          el.offsetWidth > 0 && el.offsetHeight > 0
        );
      });
      if (partialMatch) {
        console.log("[ClassSync Click] ✅ 策略4成功: 找到部分匹配的元素");
        return partialMatch;
      }
      return null;
    },
    () => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const candidates = allElements.filter((el) => {
        const text = (el.textContent || "").toLowerCase();
        const hasKeywords =
          text.includes("學習") || text.includes("週曆") || text.includes("calendar") || text.includes("learning");
        const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
        const isClickable =
          el.tagName === 'A' ||
          el.tagName === 'BUTTON' ||
          el.getAttribute('role') === 'button' ||
          el.onclick ||
          el.getAttribute('data-click') ||
          el.classList.contains('clickable') ||
          el.classList.contains('card') ||
          el.classList.contains('btn');
        return hasKeywords && isVisible && isClickable;
      });

      const bestCandidate =
        candidates.find((el) => {
          const text = (el.textContent || "").toLowerCase();
          return text.includes("學習") && text.includes("週曆");
        }) || candidates[0];

      if (bestCandidate) {
        console.log("[ClassSync Click] ✅ 策略5成功: 深度搜尋找到候選元素");
        return bestCandidate;
      }
      return null;
    }
  ];

  for (let i = 0; i < searchStrategies.length; i++) {
    try {
      const element = searchStrategies[i]();
      if (element) {
        console.log(`[ClassSync Click] 使用策略${i + 1}找到目標元素:`, {
          tagName: element.tagName,
          textContent: element.textContent?.trim().substring(0, 100),
          classList: Array.from(element.classList).slice(0, 5),
          href: element.href,
          onclick: !!element.onclick
        });

        try {
          element.click();
          console.log(`[ClassSync Click] ✅ 成功點擊元素 (策略${i + 1})`);

          setTimeout(() => {
            console.log("[ClassSync Click] 點擊後URL:", window.location.href);
          }, 200);

          return true;
        } catch (clickError) {
          console.warn(`[ClassSync Click] ⚠️ 策略${i + 1}點擊失敗:`, clickError.message);
          continue;
        }
      }
    } catch (strategyError) {
      console.warn(`[ClassSync Click] ⚠️ 策略${i + 1}執行失敗:`, strategyError.message);
      continue;
    }
  }

  console.error("[ClassSync Click] ❌ 所有搜尋策略都失敗");

  const diagnostics = {
    totalElements: document.querySelectorAll('*').length,
    buttons: document.querySelectorAll('button').length,
    links: document.querySelectorAll('a').length,
    clickableElements: document.querySelectorAll('[role="button"], [onclick], [data-click]').length,
    imagesWithAlt: document.querySelectorAll('img[alt]').length,
    hasLearningText: !!Array.from(document.querySelectorAll('*')).find((el) => el.textContent?.includes("學習")),
    hasCalendarText: !!Array.from(document.querySelectorAll('*')).find((el) => el.textContent?.includes("週曆")),
    searchTime: Date.now() - startTime
  };

  console.log("[ClassSync Click] 診斷資訊:", diagnostics);

  return false;
}

export function clickTabByText(text) {
  const tabs = Array.from(document.querySelectorAll('a.tab, button.tab, [role="tab"]'));
  const target = tabs.find((el) => (el.textContent || "").trim().includes(text));
  if (target) {
    target.click();
    return true;
  }
  return false;
}

export function clickWeeklyReportButton() {
  const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const byText = buttons.find((el) => (el.textContent || "").trim().includes("週曆填報"));
  if (byText) {
    byText.click();
    return true;
  }
  const byClass = document.querySelector('button.btn.btn-sm.btn-neutral, a.btn.btn-sm.btn-neutral');
  if (byClass) {
    byClass.click();
    return true;
  }
  return false;
}

export function clickReportPlanButton() {
  console.log("[ClassSync Submit] 開始尋找「回報計劃」按鈕");

  const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
  console.log(`[ClassSync Submit] 找到 ${candidates.length} 個按鈕元素`);

  const byText = candidates.find((el) => {
    const text = (el.textContent || "").trim();
    return text.includes("回報計劃") || text.includes("提交") || text.includes("送出");
  });

  if (byText) {
    console.log(`[ClassSync Submit] 找到文字匹配按鈕: "${byText.textContent?.trim()}"`);
    if (byText.disabled) {
      console.warn("[ClassSync Submit] ⚠️ 按鈕被禁用");
      return { clicked: false, reason: "button-disabled" };
    }

    byText.click();
    console.log("[ClassSync Submit] ✅ 成功點擊文字匹配按鈕");
    return { clicked: true, method: "by-text", buttonText: byText.textContent?.trim() };
  }

  const byClass = document.querySelector("button.btn.btn-neutral, a.btn.btn-neutral");
  if (byClass) {
    console.log(`[ClassSync Submit] 找到樣式匹配按鈕: "${byClass.textContent?.trim()}"`);

    if (byClass.disabled) {
      console.warn("[ClassSync Submit] ⚠️ 樣式匹配按鈕被禁用");
      return { clicked: false, reason: "button-disabled" };
    }

    byClass.click();
    console.log("[ClassSync Submit] ✅ 成功點擊樣式匹配按鈕");
    return { clicked: true, method: "by-class", buttonText: byClass.textContent?.trim() };
  }

  console.error("[ClassSync Submit] ❌ 找不到「回報計劃」按鈕");
  console.log(
    "[ClassSync Submit] 可用按鈕:",
    candidates.map((btn) => ({
      text: btn.textContent?.trim(),
      class: Array.from(btn.classList),
      disabled: btn.disabled
    }))
  );

  return { clicked: false, reason: "button-not-found" };
}
