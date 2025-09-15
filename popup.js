// popup.js - ClassSync UI 控制

class ClassSyncUI {
    constructor() {
        this.steps = [
            { id: 'step-1', text: '開啟 1Campus' },
            { id: 'step-2', text: '點擊學習週曆' },
            { id: 'step-3', text: '切換到 tschoolkit' },
            { id: 'step-4', text: '點擊待填下週' },
            { id: 'step-5', text: '開啟週曆填報' },
            { id: 'step-6', text: '自動填寫表單' },
            { id: 'step-7', text: '提交完成' }
        ];

        this.currentStep = 0;
        this.isRunning = false;
        this.weeklyData = null;

        this.init();
    }

    init() {
        this.bindEvents();
        this.loadStoredData();
        this.setupMessageListener();
        this.restoreUIState();
    }

    bindEvents() {
        // 開始/停止按鈕
        document.getElementById('start-btn').addEventListener('click', () => {
            this.startProcess();
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            this.stopProcess();
        });

        // 監聽 popup 關閉和重新開啟
        window.addEventListener('beforeunload', () => {
            this.saveUIState();
        });
    }

    setupMessageListener() {
        // 監聽來自 background script 的狀態更新
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log('[ClassSync UI] 收到訊息:', message);

            switch (message.type) {
                case 'STEP_UPDATE':
                    this.updateStep(message.step, message.status, message.text);
                    break;
                case 'PROCESS_STARTED':
                    this.onProcessStarted();
                    break;
                case 'PROCESS_COMPLETED':
                    this.onProcessCompleted(message.success, message.data);
                    break;
                case 'PROCESS_ERROR':
                    this.onProcessError(message.error, message.step);
                    break;
                case 'DATA_RECEIVED':
                    this.updateWeeklyData(message.data);
                    break;
            }

            sendResponse({ received: true });
        });
    }

    async loadStoredData() {
        try {
            // 載入儲存的週曆資料
            const result = await chrome.storage.session.get(['classsync_payload', 'classsync_ui_state']);

            if (result.classsync_payload) {
                this.weeklyData = result.classsync_payload;
                this.displayWeeklyData();
            }

            if (result.classsync_ui_state) {
                this.restoreState(result.classsync_ui_state);
            }
        } catch (error) {
            console.error('[ClassSync UI] 載入儲存資料失敗:', error);
        }
    }

    async saveUIState() {
        const state = {
            currentStep: this.currentStep,
            isRunning: this.isRunning,
            timestamp: Date.now()
        };

        try {
            await chrome.storage.session.set({ classsync_ui_state: state });
        } catch (error) {
            console.error('[ClassSync UI] 儲存UI狀態失敗:', error);
        }
    }

    async restoreUIState() {
        try {
            const result = await chrome.storage.session.get('classsync_ui_state');
            if (result.classsync_ui_state) {
                const state = result.classsync_ui_state;
                const timeDiff = Date.now() - state.timestamp;

                // 如果狀態是最近的（5分鐘內），則恢復
                if (timeDiff < 5 * 60 * 1000) {
                    this.currentStep = state.currentStep;
                    this.isRunning = state.isRunning;
                    this.updateUI();
                }
            }
        } catch (error) {
            console.error('[ClassSync UI] 恢復UI狀態失敗:', error);
        }
    }

    restoreState(state) {
        this.currentStep = state.currentStep || 0;
        this.isRunning = state.isRunning || false;
        this.updateUI();
    }

    startProcess() {
        console.log('[ClassSync UI] 開始執行流程');

        // 重置狀態
        this.currentStep = 0;
        this.isRunning = true;
        this.resetSteps();
        this.updateUI();

        // 通知 background script 開始執行
        chrome.runtime.sendMessage({
            type: 'START_CLASSSYNC',
            timestamp: Date.now()
        }).catch(error => {
            console.error('[ClassSync UI] 發送開始訊息失敗:', error);
            this.onProcessError('無法啟動自動化流程', 0);
        });
    }

    stopProcess() {
        console.log('[ClassSync UI] 停止執行流程');

        this.isRunning = false;
        this.updateUI();

        // 通知 background script 停止執行
        chrome.runtime.sendMessage({
            type: 'STOP_CLASSSYNC',
            timestamp: Date.now()
        }).catch(error => {
            console.error('[ClassSync UI] 發送停止訊息失敗:', error);
        });
    }

    updateStep(stepIndex, status, customText = null) {
        console.log(`[ClassSync UI] 更新步驟 ${stepIndex + 1}: ${status}`);

        if (stepIndex < 0 || stepIndex >= this.steps.length) {
            console.warn('[ClassSync UI] 無效的步驟索引:', stepIndex);
            return;
        }

        const stepElement = document.getElementById(this.steps[stepIndex].id);
        if (!stepElement) {
            console.warn('[ClassSync UI] 找不到步驟元素:', this.steps[stepIndex].id);
            return;
        }

        const iconElement = stepElement.querySelector('.step-icon');
        const textElement = stepElement.querySelector('.step-text');

        // 移除舊的狀態類別
        iconElement.classList.remove('pending', 'running', 'completed', 'error');
        textElement.classList.remove('completed', 'error');

        // 添加新的狀態
        iconElement.classList.add(status);
        if (status === 'completed' || status === 'error') {
            textElement.classList.add(status);
        }

        // 更新圖示內容
        if (status === 'completed') {
            iconElement.textContent = '✓';
        } else if (status === 'error') {
            iconElement.textContent = '✗';
        } else if (status === 'running') {
            iconElement.textContent = '⟳';
        } else {
            iconElement.textContent = stepIndex + 1;
        }

        // 更新文字（如果有自訂文字）
        if (customText) {
            textElement.textContent = customText;
        }

        // 更新當前步驟
        if (status === 'running') {
            this.currentStep = stepIndex;
        } else if (status === 'completed' && stepIndex === this.currentStep) {
            this.currentStep = Math.min(stepIndex + 1, this.steps.length);
        }

        this.saveUIState();
    }

    resetSteps() {
        this.steps.forEach((step, index) => {
            const stepElement = document.getElementById(step.id);
            const iconElement = stepElement.querySelector('.step-icon');
            const textElement = stepElement.querySelector('.step-text');

            iconElement.classList.remove('running', 'completed', 'error');
            iconElement.classList.add('pending');
            iconElement.textContent = index + 1;

            textElement.classList.remove('completed', 'error');
            textElement.textContent = step.text;
        });

        this.currentStep = 0;
    }

    onProcessStarted() {
        console.log('[ClassSync UI] 流程已開始');
        this.isRunning = true;
        this.updateUI();
    }

    onProcessCompleted(success, data = null) {
        console.log('[ClassSync UI] 流程完成:', success);

        this.isRunning = false;

        if (success) {
            // 標記最後一步為完成
            this.updateStep(this.steps.length - 1, 'completed');
            this.showSuccessMessage();
        }

        if (data) {
            this.updateWeeklyData(data);
        }

        this.updateUI();
        this.saveUIState();
    }

    onProcessError(error, stepIndex = null) {
        console.error('[ClassSync UI] 流程錯誤:', error);

        this.isRunning = false;

        if (stepIndex !== null && stepIndex >= 0 && stepIndex < this.steps.length) {
            this.updateStep(stepIndex, 'error', `${this.steps[stepIndex].text} (錯誤)`);
        }

        this.showErrorMessage(error);
        this.updateUI();
        this.saveUIState();
    }

    updateWeeklyData(data) {
        console.log('[ClassSync UI] 更新週曆資料:', data);

        this.weeklyData = data;
        this.displayWeeklyData();

        // 儲存資料
        chrome.storage.session.set({ classsync_payload: data }).catch(error => {
            console.error('[ClassSync UI] 儲存週曆資料失敗:', error);
        });
    }

    displayWeeklyData() {
        const dataSection = document.getElementById('data-section');
        const dataList = document.getElementById('data-list');

        if (!this.weeklyData || !this.weeklyData.days) {
            dataSection.classList.add('hidden');
            return;
        }

        dataSection.classList.remove('hidden');
        dataSection.classList.add('fade-in');

        // 清空現有內容
        dataList.innerHTML = '';

        // 顯示週曆資料
        this.weeklyData.days.forEach((day, index) => {
            const dayElement = document.createElement('div');
            dayElement.className = 'data-item';
            dayElement.innerHTML = `
                <div>
                    <strong>${day.dateISO}</strong><br>
                    <small>${day.slots.join(', ')}</small>
                </div>
                <button class="copy-btn" data-day-index="${index}">複製</button>
            `;

            // 綁定複製事件
            const copyBtn = dayElement.querySelector('.copy-btn');
            copyBtn.addEventListener('click', () => {
                this.copyDayData(index);
            });

            dataList.appendChild(dayElement);
        });

        // 添加全部複製按鈕
        const allCopyElement = document.createElement('div');
        allCopyElement.className = 'data-item';
        allCopyElement.innerHTML = `
            <div><strong>完整週曆資料</strong></div>
            <button class="copy-btn" id="copy-all-btn">全部複製</button>
        `;

        document.getElementById('copy-all-btn')?.removeEventListener('click', this.copyAllData);
        allCopyElement.querySelector('#copy-all-btn').addEventListener('click', () => {
            this.copyAllData();
        });

        dataList.appendChild(allCopyElement);
    }

    async copyDayData(dayIndex) {
        if (!this.weeklyData || !this.weeklyData.days[dayIndex]) {
            console.error('[ClassSync UI] 無效的日期索引:', dayIndex);
            return;
        }

        const day = this.weeklyData.days[dayIndex];
        const text = `${day.dateISO}: ${day.slots.join(', ')}`;

        try {
            await navigator.clipboard.writeText(text);
            this.showCopySuccess(document.querySelector(`[data-day-index="${dayIndex}"]`));
        } catch (error) {
            console.error('[ClassSync UI] 複製失敗:', error);
            this.fallbackCopy(text);
        }
    }

    async copyAllData() {
        if (!this.weeklyData) {
            console.error('[ClassSync UI] 沒有可複製的資料');
            return;
        }

        const text = JSON.stringify(this.weeklyData, null, 2);

        try {
            await navigator.clipboard.writeText(text);
            this.showCopySuccess(document.getElementById('copy-all-btn'));
        } catch (error) {
            console.error('[ClassSync UI] 複製失敗:', error);
            this.fallbackCopy(text);
        }
    }

    showCopySuccess(buttonElement) {
        const originalText = buttonElement.textContent;
        buttonElement.textContent = '已複製!';
        buttonElement.classList.add('copied');

        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.classList.remove('copied');
        }, 1500);
    }

    fallbackCopy(text) {
        // 使用較舊的複製方法作為備案
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();

        try {
            document.execCommand('copy');
            console.log('[ClassSync UI] 備用複製方法成功');
        } catch (error) {
            console.error('[ClassSync UI] 備用複製方法也失敗:', error);
        }

        document.body.removeChild(textArea);
    }

    updateUI() {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');

        if (this.isRunning) {
            startBtn.disabled = true;
            startBtn.textContent = '執行中...';
            stopBtn.disabled = false;
        } else {
            startBtn.disabled = false;
            startBtn.textContent = '開始執行';
            stopBtn.disabled = true;
        }
    }

    showSuccessMessage() {
        // 可以在這裡添加成功提示
        console.log('[ClassSync UI] 顯示成功訊息');
    }

    showErrorMessage(error) {
        // 可以在這裡添加錯誤提示
        console.error('[ClassSync UI] 顯示錯誤訊息:', error);
    }
}

// 初始化UI
document.addEventListener('DOMContentLoaded', () => {
    console.log('[ClassSync UI] DOM 載入完成，初始化UI');
    new ClassSyncUI();
});

// 定期檢查 background script 的狀態
setInterval(async () => {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'PING' });
        if (!response) {
            console.warn('[ClassSync UI] Background script 似乎沒有回應');
        }
    } catch (error) {
        console.warn('[ClassSync UI] 無法與 background script 通訊:', error.message);
    }
}, 10000); // 每10秒檢查一次