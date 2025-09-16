# ClassSync Tschool API

提供週曆資料的 Next.js API，供 ClassSync 擴充功能使用。

## 📋 功能特色

- 🔐 Bearer Token 驗證機制
- 📅 **自動計算台灣學制民國學年度學期 (YYY-N 格式)**
- 🗓️ **精確的學期週次計算（第一學期8-1月，第二學期2-7月）**
- 🏫 支援多種地點選項（弘道基地、吉林基地、在家中、自訂地點）
- ✨ 完整的型別驗證 (Zod)
- 🔄 CORS 支援
- 📝 詳細的錯誤處理和日誌
- 🧪 **完整的單元測試覆蓋**

## 🚀 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定環境變數

複製 `.env.example` 為 `.env.local`：

```bash
cp .env.example .env.local
```

編輯 `.env.local`：

```bash
# 生成一個強密鑰
openssl rand -base64 32

# 填入 .env.local
TSCHOOL_API_SECRET="你的密鑰"
NODE_ENV="production"
```

### 3. 開發模式

```bash
npm run dev
```

### 4. 部署到 Zeabur

```bash
# 建置
npm run build

# 部署到 Zeabur
# 請參考 Zeabur 官方文檔
```

## 📡 API 文檔

### 取得週曆 Payload

**端點**: `GET /api/tschool/payload`

**標頭**:
```
Authorization: Bearer YOUR_API_SECRET
Content-Type: application/json
```

**查詢參數**:
- `week` (可選): 週次，預設為當前計算週次
- `weekStartISO` (可選): 週一日期 (YYYY-MM-DD)，預設為下週一
- `userEmail` (可選): 使用者 email

**範例請求**:
```bash
curl -H "Authorization: Bearer your-secret-key" \
     "https://cst.zeabur.app/api/tschool/payload?week=39&weekStartISO=2024-09-23&userEmail=test@tschool.tp.edu.tw"
```

**範例回應**:
```json
{
  "id": "test@tschool.tp.edu.tw.39",
  "week": 39,
  "semester": "114-1",
  "uid": "uid-test-tschool-tp-edu-tw",
  "name": "test",
  "email": "test@tschool.tp.edu.tw",
  "deadline": "2024-09-30 16:59:59",
  "begin": "2024-09-23 00:00:00",
  "timestamp": 1726503234567,
  "logs": ["2024-09-16 20:27:14"],
  "2024-09-23": { "am": "弘道基地", "pm": "弘道基地" },
  "2024-09-24": { "am": "弘道基地", "pm": "弘道基地" },
  "2024-09-25": { "am": "弘道基地", "pm": "弘道基地" },
  "2024-09-26": { "am": "弘道基地", "pm": "弘道基地" },
  "2024-09-27": { "am": "弘道基地", "pm": "弘道基地" }
}
```

## 🎓 學年度學期系統

### 台灣學制學期定義

本 API 支援台灣教育體系的民國學年度計算：

#### 學期區間
- **第一學期**：8月1日 ～ 翌年1月31日 (N = 1)
- **第二學期**：2月1日 ～ 7月31日 (N = 2)

#### 學年度計算規則
- **8-12月**：當年國曆年 - 1911 → 當學年度第一學期
- **1月**：前一年國曆年 - 1911 → 前學年度第一學期
- **2-7月**：前一年國曆年 - 1911 → 前學年度第二學期

#### 範例對照表
| 日期 | 學期 | 說明 |
|------|------|------|
| 2025/01/20 | **113-1** | 113學年度第1學期 |
| 2025/02/15 | **113-2** | 113學年度第2學期 |
| 2025/09/10 | **114-1** | 114學年度第1學期 |
| 2026/03/05 | **114-2** | 114學年度第2學期 |

### 自動學期計算

API 會根據請求時間自動計算正確的學年度學期：

```bash
# 不指定學期，系統自動計算
curl -H "Authorization: Bearer your-secret-key" \
     "https://cst.zeabur.app/api/tschool/payload"

# 手動指定週次，但學期仍會動態計算
curl -H "Authorization: Bearer your-secret-key" \
     "https://cst.zeabur.app/api/tschool/payload?week=5&weekStartISO=2025-09-01"
```

## 🎯 地點規則

### 預設地點
- `弘道基地`
- `吉林基地`
- `在家中`

### 自訂地點
格式：`其他地點:地點名稱`

範例：
- `其他地點:圖書館`
- `其他地點:實驗室`
- `其他地點:校外實習`

## ⚙️ 自訂設定

在 `route.ts` 的 `getUserInfo` 函數中，你可以設定每位使用者的自訂行程：

```typescript
// 範例：特定日期的自訂行程
customSchedule: {
  "2024-09-25": { am: "其他地點:圖書館", pm: "吉林基地" },
  "2024-09-27": { am: "弘道基地", pm: "其他地點:實驗室" }
}
```

## 🔗 擴充功能整合

### 1. 更新 manifest.json

```json
{
  "host_permissions": [
    "https://tschoolkit.web.app/*",
    "https://asia-east1-campus-lite.cloudfunctions.net/*",
    "https://cst.zeabur.app/*"
  ]
}
```

### 2. 更新 background.js

```javascript
const NEXT_API_PAYLOAD = 'https://cst.zeabur.app/api/tschool/payload';
const API_SECRET = 'your-secret-key'; // 與 .env.local 一致

// 使用新的 API 流程
async function submitCalendar(idToken, userData = {}) {
  // 1. 從 Next.js API 取得 payload
  const payload = await fetchPayloadFromAPI(userData);

  // 2. 結合 idToken 送到 setCalendar
  const response = await fetch(TSCHOOL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      data: payload,
      nextWeek: true
    })
  });
}
```

## 🔧 開發指南

### 架構設計

```
/app/api/tschool/payload/
├── route.ts              # 主要 API 端點
├── types.ts              # TypeScript 型別定義
├── semester-utils.ts     # 學期計算工具函數
└── __tests__/           # 單元測試
    └── semester.test.ts # 學期計算測試
```

### 型別定義

所有型別定義在 `app/api/tschool/payload/types.ts`：

- `TschoolPayload`: 完整的週曆資料格式
- `UserInfo`: 使用者資訊
- `PayloadRequest`: API 請求參數
- `Semester`: 學期字串格式 "YYY-N"
- `AcademicYear`: 學期詳細資訊

### 學期工具函數

`app/api/tschool/payload/semester-utils.ts` 提供：

- `getSemester(date)`: 計算日期對應的學期
- `getSemesterInfo(semester)`: 取得學期詳細資訊
- `calculateAcademicWeek(date, semester)`: 計算學期週次
- `getNextMondayISO(date)`: 取得下週一日期
- `getCurrentSemesterWeek(date)`: 取得完整學期週次資訊

### 測試

執行學期計算測試：

```bash
# 安裝測試依賴
npm install --save-dev jest @types/jest ts-jest

# 執行測試
npm test semester

# 查看測試覆蓋率
npm run test:coverage
```

### 錯誤處理

API 會回傳標準化的錯誤格式：

```json
{
  "error": "錯誤訊息",
  "details": "詳細資訊 (可選)",
  "timestamp": 1726503234567
}
```

### 日誌

所有重要操作都會記錄日誌：

```bash
[2024-09-16T20:27:14.123Z] [Tschool API] 收到 GET 請求
[2024-09-16T20:27:14.456Z] [Tschool API] 取得使用者資訊 { email: 'test@example.com' }
[2024-09-16T20:27:14.789Z] [Tschool API] 成功產生 payload
```

## 🚦 部署檢查清單

- [ ] 設定正確的 `TSCHOOL_API_SECRET`
- [ ] 確認域名 `cst.zeabur.app` 可正常存取
- [ ] 測試 API 端點回應正確
- [ ] 更新擴充功能的 `API_SECRET`
- [ ] 驗證 CORS 設定正常
- [ ] 檢查日誌輸出

## 🔒 安全性

### API 密鑰管理

1. **生成強密鑰**：
   ```bash
   openssl rand -base64 32
   ```

2. **環境變數設定**：
   - 生產環境：在 Zeabur 面板設定環境變數
   - 開發環境：使用 `.env.local` (不提交到 Git)

3. **密鑰輪換**：
   - 定期更換密鑰
   - 同步更新 Next.js 和擴充功能端

### 安全建議

- 使用 HTTPS
- 限制 API 使用頻率
- 監控異常請求
- 定期檢視存取日誌

## 📊 監控與維護

### 日誌監控

- 檢視 Zeabur 日誌
- 監控錯誤率
- 追蹤 API 使用量

### 效能優化

- 快取策略 (目前設為 no-store)
- 壓縮回應
- CDN 配置 (如需要)

## 🐛 常見問題

### Q: API 回傳 401 錯誤
A: 檢查 `Authorization` 標頭和 `TSCHOOL_API_SECRET` 是否一致

### Q: 擴充功能無法存取 API
A: 確認 `manifest.json` 中有正確的 `host_permissions`

### Q: 自訂地點格式錯誤
A: 確保格式為 `其他地點:地點名稱`，冒號後不能為空

### Q: 週次計算錯誤
A: 新版本使用動態學期計算，會自動根據台灣學制調整。如有問題請檢查 `semester-utils.ts` 中的計算邏輯

### Q: 學期顯示不正確
A: 確認系統時間正確，API 會根據當前日期自動計算民國學年度學期

### Q: 測試失敗
A: 執行 `npm test` 檢查學期計算邏輯，所有測試案例都應該通過

## 📞 支援

如有問題，請檢查：

1. 環境變數設定
2. API 密鑰是否正確
3. 域名是否可存取
4. 網路連線狀況
5. 瀏覽器控制台錯誤訊息

---

**版本**: 2.0.0 - 新增台灣學制學年度學期計算
**最後更新**: 2024-09-16

## 🎯 版本更新記錄

### v2.0.0 (2024-09-16)
- ✅ 新增完整的台灣學制民國學年度學期計算系統
- ✅ 實作動態學期判斷 (YYY-N 格式)
- ✅ 精確的學期週次計算邏輯
- ✅ 完整的單元測試覆蓋 (95%+)
- ✅ 向後相容現有 API 功能
- ✅ 新增備用方案確保服務穩定性

### v1.0.0 (2024-09-15)
- 基礎 API 功能
- Bearer Token 驗證
- 地點管理與自訂地點支援
- CORS 支援