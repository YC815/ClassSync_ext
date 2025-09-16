# ClassSync 自定義地點填寫修復總結

## 修復內容

### 1. 主要問題
- **`isInputReady` 函數過於嚴苛**：使用 `offsetWidth/offsetHeight` 檢查導致輸入框被錯誤認定為不可用
- **React 受控輸入框同步問題**：直接設置 `input.value` 無法更新框架內部狀態
- **輪詢等待機制不穩定**：使用 `setInterval` 等待輸入框出現效率低且容易超時

### 2. 修復方案

#### 2.1 改進 `isInputReady` 函數
```javascript
function isInputReady(input) {
  if (!input) return false;
  const cs = getComputedStyle(input);
  const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  return visible && !input.disabled && !input.readOnly;
}
```
- 移除不可靠的 `offsetWidth/offsetHeight` 檢查
- 改用 `getComputedStyle` 檢查可見性

#### 2.2 新增 `setNativeInputValue` 函數
```javascript
function setNativeInputValue(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}
```
- 使用原生 HTMLInputElement setter 跳過框架攔截
- 正確觸發 `input` 和 `change` 事件

#### 2.3 新增 `getOrWaitCustomInput` 函數
```javascript
function getOrWaitCustomInput(container, select, maxWaitMs = 3000) {
  return new Promise((resolve) => {
    const q = () => container?.querySelector('input[type="text"], input[placeholder*="地點"], input[placeholder*="名稱"], input.input');
    let found = q();
    if (found) return resolve(found);

    // 使用 MutationObserver 等待輸入框出現
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
```
- 使用 `MutationObserver` 替代輪詢
- 更高效地等待動態生成的輸入框

#### 2.4 重構 `fillCustomLocation` 函數
```javascript
async function fillCustomLocation(container, customName, slotIndex) {
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
      return { success: false, reason: 'no-input', customLocationValue: null };
    }

    // 強制解除禁用狀態
    input.disabled = false;
    input.readOnly = false;

    // 使用新的填寫方法
    input.focus();
    setNativeInputValue(input, customName);
    input.blur();

    // 驗證結果
    const ok = input.value === customName;
    return { success: ok, reason: ok ? 'filled' : 'value-mismatch', customLocationValue: input.value };
  } catch (err) {
    return { success: false, reason: 'fill-error', customLocationValue: null, error: err?.message };
  }
}
```

### 3. 修復的文件
1. **`test_fill_function.html`** - 測試腳本，支持自定義地點測試
2. **`background.js`** - 主要 Chrome 擴展腳本
3. **`test_modal.html`** - 模態框測試腳本
4. **`custom_location_test.html`** - 專門的自定義地點驗證測試
5. **`tschoolkit_custom_place.html`** - 已有的自定義地點測試（保持原樣）

### 4. 解決的具體問題
- ✅ **9/24（三）時段2「實習公司」填寫失敗** - 解決了 `isInputReady` 誤判問題
- ✅ **9/26（五）時段1「圖書館」填寫失敗** - 解決了 React 受控輸入框同步問題
- ✅ **輪詢超時問題** - 使用 `MutationObserver` 提高等待效率
- ✅ **事件觸發不完整** - 確保正確觸發所有必要事件

### 5. 測試結果
- ✅ 基本自定義地點填寫測試通過
- ✅ 已預設為其他地點的情況測試通過
- ✅ React 受控輸入框測試通過（經修復後）
- ✅ 所有腳本使用統一的修復邏輯

### 6. 使用說明
1. **測試修復效果**：開啟 `custom_location_test.html` 進行測試
2. **驗證實際效果**：開啟 `test_modal.html` 進行完整測試
3. **Chrome 擴展**：重新載入擴展後，在 1Campus 實際使用

### 7. 技術要點
- **原生 setter 使用**：確保跳過框架層的 value 攔截
- **MutationObserver**：高效等待動態 DOM 變化
- **計算樣式檢查**：比幾何尺寸檢查更可靠
- **容錯機制**：即使偵測為不可用也會嘗試填寫
- **事件完整性**：確保觸發框架所需的所有事件

此修復應該解決了之前在實際使用中遇到的自定義地點填寫失敗問題。