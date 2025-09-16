export async function fillModalInPage(payload) {
  // 使用重構後的三輪式填寫邏輯
  try {
    console.log("[ClassSync Fill] 開始填寫 Modal，payload:", payload);
    console.log("[ClassSync Fill Debug] 執行環境檢查 - window 存在:", typeof window !== 'undefined');
    console.log("[ClassSync Fill Debug] 執行環境檢查 - document 存在:", typeof document !== 'undefined');

    // 內聯必要的輔助函數
    function normalizeSlot(slot) {
      if (typeof slot === 'string') {
        // 處理舊格式的自訂地點："其他地點:地點名稱"
        if (slot.includes(':') && slot.startsWith('其他地點:')) {
          const customName = slot.substring(5); // 移除 "其他地點:" 前綴（5個字符）
          return {
            location: "其他地點",
            customName: customName.trim(),
            isCustom: true
          };
        }
        // 標準地點
        return {
          location: slot,
          customName: null,
          isCustom: false
        };
      } else if (typeof slot === 'object' && slot !== null && slot.location && slot.customName) {
        // 新格式的自訂地點物件
        return {
          location: slot.location,
          customName: slot.customName,
          isCustom: true
        };
      }

      // 無效格式，返回預設值
      return {
        location: "在家中",
        customName: null,
        isCustom: false
      };
    }

    console.log("[ClassSync Fill Debug] normalizeSlot 函數已定義:", typeof normalizeSlot === 'function');


    // 內聯新版本的輔助函數
    // 更穩健的可編輯判斷
    function isEditable(el) {
      if (!el) return false;
      const cs = window.getComputedStyle(el);
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
      const enabled = !el.disabled && !el.readOnly && !el.hasAttribute('aria-disabled');
      return visible && enabled;
    }

    // 以 MutationObserver + 兩次 rAF 等待「真的可編輯」
    function waitUntilEditable(targetEl, { timeout = 3000 } = {}) {
      return new Promise((resolve) => {
        if (isEditable(targetEl)) return resolve(true);

        let done = false;
        const stop = () => { if (!done) { done = true; obs.disconnect(); clearTimeout(tid); } };

        const obs = new MutationObserver(async () => {
          // 多等兩個 animation frame，確保 layout 與樣式完成
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          if (isEditable(targetEl)) { stop(); resolve(true); }
        });

        obs.observe(document.documentElement, { attributes: true, childList: true, subtree: true });

        const tid = setTimeout(() => { stop(); resolve(false); }, timeout);
      });
    }

    // 修復後的自定義地點填寫相關函數

    // 比原本「寬高>0」更穩定：看 computedStyle 與禁用態
    function isInputReady(input) {
      if (!input) return false;
      const cs = getComputedStyle(input);
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      return visible && !input.disabled && !input.readOnly;
    }

    // 用原生 setter 寫值，解決 React/受控輸入不同步
    function setNativeInputValue(input, value) {
      // 使用 HTMLInputElement.prototype.value setter 確保跳過任何框架攔截
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

      if (nativeSetter) {
        nativeSetter.call(input, value);
      } else {
        // 理論上不會走到這，但保底
        input.value = value;
      }

      // 對受控元件，input 事件是關鍵
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }

    // 等待/取得該 slot 的自訂輸入框：優先用 MutationObserver，退而求其次輪詢
    function getOrWaitCustomInput(container, select, maxWaitMs = 3000) {
      return new Promise((resolve) => {
        // 先查一次
        const q = () => container?.querySelector('input[type="text"], input[placeholder*="地點"], input[placeholder*="名稱"], input.input');
        let found = q();
        if (found) return resolve(found);

        // 確保 select 已是「其他地點」
        if (select && select.value !== '其他地點') {
          select.value = '其他地點';
          select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }

        // 用 MutationObserver 等待輸入框出現
        const obs = new MutationObserver(() => {
          const el = q();
          if (el) {
            obs.disconnect();
            resolve(el);
          }
        });
        if (container) {
          obs.observe(container, { childList: true, subtree: true });
        }

        // 兜底 timeout
        setTimeout(() => {
          obs.disconnect();
          resolve(q() || null);
        }, maxWaitMs);
      });
    }

    async function fillCustomLocation(container, customName, slotIndex) {
      console.log(`測試填寫自訂地點: 時段 ${slotIndex + 1}, 地點: "${customName}"`);
      try {
        const select = container?.querySelector('select');

        // 確保「其他地點」已選
        if (select && select.value !== '其他地點') {
          select.value = '其他地點';
          select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }

        // 取得或等待 input
        const input = await getOrWaitCustomInput(container, select, 3000);

        if (!input) {
          console.error(`時段 ${slotIndex + 1}: 找不到輸入框`);
          return { success: false, reason: 'no-input', customLocationValue: null };
        }

        // 有些站點會短暫設為 readonly/disabled，這裡強制解除一次
        input.disabled = false;
        input.readOnly = false;

        // 滾到可見（避免某些框架對不可見元素忽略事件）
        input.scrollIntoView?.({ block: 'center', inline: 'nearest' });

        // 就算 isInputReady 回 false，也先試著填 — 很多時候其實能寫
        input.focus();
        setNativeInputValue(input, customName);
        input.blur();

        // 驗證
        const ok = input.value === customName;
        console.log(`時段 ${slotIndex + 1}: 自訂地點填寫 ${ok ? '✅' : '❌'} "${customName}" -> "${input.value}"`);
        return { success: ok, reason: ok ? 'filled' : 'value-mismatch', customLocationValue: input.value };
      } catch (err) {
        console.error(`時段 ${slotIndex + 1}: 填寫時發生錯誤:`, err);
        return { success: false, reason: 'fill-error', customLocationValue: null, error: err?.message };
      }
    }

    console.log("[ClassSync Fill Debug] fillCustomLocation 函數已定義:", typeof fillCustomLocation === 'function');

    // 檢查執行環境
    if (typeof document === 'undefined') {
      console.error("[ClassSync Fill] ❌ Document 物件不存在，執行環境異常");
      return {
        ok: false,
        reason: "no-document",
        details: "Document object not available",
        filledDays: 0,
        totalDays: payload?.days?.length || 0,
        errors: [{ err: "no-document", details: "Document object not available" }],
        successRate: 0
      };
    }

    // 檢查 payload 有效性
    if (!payload || !payload.days || !Array.isArray(payload.days)) {
      console.error("[ClassSync Fill] ❌ 無效的 payload 格式");
      return {
        ok: false,
        reason: "invalid-payload",
        details: "Invalid payload format",
        filledDays: 0,
        totalDays: 0,
        errors: [{ err: "invalid-payload", details: "Payload is null or missing days array" }],
        successRate: 0
      };
    }

    // 檢查 modal 容器 - 更新選擇器以匹配實際 HTML 結構
    const modal = document.querySelector(".modal-box") ||
                 document.querySelector('[role="dialog"]') ||
                 document.querySelector('.modal') ||
                 document.querySelector('#next-week-event-modal .modal-box');

    if (!modal) {
      console.error("[ClassSync Fill] ❌ 找不到 modal 容器");
      return {
        ok: false,
        reason: "no-modal",
        details: "Modal element not found",
        filledDays: 0,
        totalDays: payload.days.length,
        errors: [{ err: "no-modal", details: "Modal element not found" }],
        successRate: 0
      };
    }

    console.log("[ClassSync Fill] ✅ 找到 modal 容器:", modal);

    // 檢查 modal 是否可見
    if (modal.offsetWidth === 0 || modal.offsetHeight === 0) {
      console.error("[ClassSync Fill] ❌ Modal 不可見");
      return {
        ok: false,
        reason: "modal-not-visible",
        details: "Modal is not visible",
        filledDays: 0,
        totalDays: payload.days.length,
        errors: [{ err: "modal-not-visible", details: "Modal is not visible" }],
        successRate: 0
      };
    }

    const result = {
      ok: true,
      filledDays: 0,
      totalDays: payload.days.length,
      errors: [],
      details: []
    };

    // 找到日期區塊：<div class="p-4 space-y-4">
    const blocks = Array.from(modal.querySelectorAll(".p-4.space-y-4"));
    console.log(`[ClassSync Fill] 找到 ${blocks.length} 個日期區塊`);

    if (!blocks.length) {
      console.error("[ClassSync Fill] ❌ 找不到日期區塊");
      return {
        ok: false,
        reason: "no-day-blocks",
        details: "No day blocks found in modal",
        filledDays: 0,
        totalDays: payload.days.length,
        errors: [{ err: "no-day-blocks", details: "No day blocks found in modal" }],
        successRate: 0
      };
    }

    // 建立日期對應表
    const blockByDate = new Map();
    blocks.forEach((block, index) => {
      const title = block.querySelector("p.text-xl.text-primary");
      const txt = (title?.textContent || "").trim();
      const dateStr = txt.slice(0, 10); // 提取 YYYY-MM-DD 格式
      blockByDate.set(dateStr, block);
      console.log(`[ClassSync Fill] 區塊 ${index + 1}: ${txt} -> ${dateStr}`);
    });

    // 逐日填寫
    for (const d of payload.days) {
      console.log(`[ClassSync Fill] 處理日期: ${d.dateISO}, 地點: [${d.slots.join(', ')}]`);

      const block = blockByDate.get(d.dateISO);
      if (!block) {
        const error = { date: d.dateISO, err: "block-not-found" };
        result.errors.push(error);
        console.error(`[ClassSync Fill] ❌ 找不到日期區塊: ${d.dateISO}`);
        continue;
      }

      const selects = Array.from(block.querySelectorAll("select"));
      console.log(`[ClassSync Fill] 日期 ${d.dateISO} 找到 ${selects.length} 個下拉選單`);

      if (!selects.length) {
        const error = { date: d.dateISO, err: "no-selects" };
        result.errors.push(error);
        console.error(`[ClassSync Fill] ❌ 日期 ${d.dateISO} 找不到下拉選單`);
        continue;
      }

      let dayFilled = true;
      const dayDetails = { date: d.dateISO, slots: [] };

      // 填寫每個時段
      for (let i = 0; i < Math.min(selects.length, d.slots.length); i++) {
        const sel = selects[i];
        const rawSlot = d.slots[i];

        console.log(`[ClassSync Fill Debug] 時段 ${i + 1}: 原始 slot 資料:`, rawSlot);
        console.log(`[ClassSync Fill Debug] 時段 ${i + 1}: normalizeSlot 函數存在:`, typeof normalizeSlot === 'function');

        const normalizedSlot = normalizeSlot(rawSlot);

        console.log(`[ClassSync Fill Debug] 時段 ${i + 1}: 標準化後的 slot:`, normalizedSlot);
        const opts = Array.from(sel.options || []);

        console.log(`[ClassSync Fill] 時段 ${i + 1}: 處理 slot`, normalizedSlot);
        console.log(`[ClassSync Fill] 可用選項: [${opts.map(o => `"${o.value}": "${o.textContent?.trim()}"`).join(', ')}]`);

        // 尋找匹配的選項 - 使用標準化後的地點名稱
        const wantedLocation = normalizedSlot.location;
        let target = opts.find(o => {
          const optText = (o.textContent || "").trim();
          const optValue = (o.value || "").trim();
          return optText === wantedLocation || optValue === wantedLocation;
        });

        if (!target) {
          // 嘗試模糊匹配
          target = opts.find(o => {
            const optText = (o.textContent || "").trim();
            return optText.includes(wantedLocation) || wantedLocation.includes(optText);
          });
        }

        if (!target) {
          // 如果找不到匹配，使用第一個非 disabled 的有效選項
          target = opts.find(o =>
            !o.disabled &&
            o.value &&
            o.value !== "none" &&
            o.value !== "" &&
            (o.textContent || "").trim() !== ""
          );
        }

        if (target) {
          const oldValue = sel.value;

          // 同步選項狀態並觸發事件
          target.selected = true;
          sel.value = target.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          sel.dispatchEvent(new Event("input", { bubbles: true }));

          // 等待 DOM/框架更新
          await new Promise(r => setTimeout(r, 100));

          // 處理自訂地點填寫
          let customLocationResult = { success: true, customLocationValue: null };

          if (normalizedSlot.isCustom && target.value === "其他地點") {
            const container = sel.closest('.w-full');
            customLocationResult = await fillCustomLocation(container, normalizedSlot.customName, i);
          }

          // 驗證是否設定成功
          const newValue = sel.value;
          const selectSuccess = newValue === target.value;
          const overallSuccess = selectSuccess && customLocationResult.success;

          console.log(`[ClassSync Fill] 時段 ${i + 1}: ${overallSuccess ? '✅' : '❌'} ${JSON.stringify(normalizedSlot)} -> "${target.textContent?.trim()}" (${oldValue} -> ${newValue})${customLocationResult.customLocationValue ? ` + 自訂地點: "${customLocationResult.customLocationValue}"` : ''}`);

          dayDetails.slots.push({
            index: i,
            wanted: normalizedSlot,
            selected: target.textContent?.trim(),
            value: target.value,
            oldValue: oldValue,
            newValue: newValue,
            customLocationValue: customLocationResult.customLocationValue,
            success: overallSuccess
          });

          if (!overallSuccess) {
            dayFilled = false;
            result.errors.push({
              date: d.dateISO,
              idx: i,
              err: selectSuccess ? "custom-location-failed" : "set-value-failed",
              wanted: normalizedSlot,
              attempted: target.value,
              oldValue: oldValue,
              newValue: newValue,
              customLocationResult: customLocationResult,
              selectSuccess: selectSuccess
            });
          }
        } else {
          console.error(`[ClassSync Fill] ❌ 時段 ${i + 1}: 找不到適合的選項給`, normalizedSlot);
          dayFilled = false;
          result.errors.push({
            date: d.dateISO,
            idx: i,
            err: "option-not-found",
            wanted: normalizedSlot,
            availableOptions: opts.map(o => `"${o.value}": "${o.textContent?.trim()}"`).filter(Boolean)
          });

          dayDetails.slots.push({
            index: i,
            wanted: normalizedSlot,
            selected: null,
            value: null,
            success: false
          });
        }
      }

      result.details.push(dayDetails);
      if (dayFilled) {
        result.filledDays += 1;
      }
    }

    // 計算成功率
    result.successRate = result.totalDays > 0 ? result.filledDays / result.totalDays : 0;
    result.ok = result.errors.length === 0;

    console.log(`[ClassSync Fill] 填寫完成: ${result.filledDays}/${result.totalDays} 天成功，錯誤數 ${result.errors.length}`);
    console.log(`[ClassSync Fill] 詳細結果:`, result);

    return result;

  } catch (error) {
    console.error("[ClassSync Fill] ❌ 函數執行時發生未預期錯誤:", error);

    // 確保總是返回一個有效的結果對象
    return {
      ok: false,
      reason: "unexpected-error",
      details: error.message || "Unknown error occurred",
      filledDays: 0,
      totalDays: payload?.days?.length || 0,
      errors: [{
        err: "unexpected-error",
        details: error.message || "Unknown error occurred",
        stack: error.stack
      }],
      successRate: 0
    };
  }

}
