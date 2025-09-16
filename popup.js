// popup.js - ClassSync 簡化版 UI 控制

class ClassSyncUI {
    constructor() {
        this.isRunning = false;
        this.init();
    }

    init() {
        this.bindEvents();
        this.setupMessageListener();
        this.updateUI();
    }

    bindEvents() {
        document.getElementById('start-btn').addEventListener('click', () => {
            this.startProcess();
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            this.stopProcess();
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log('[ClassSync UI] 收到訊息:', message);

            switch (message.type) {
                case 'PROCESS_STARTED':
                    this.onProcessStarted();
                    break;
                case 'PROCESS_COMPLETED':
                    this.onProcessCompleted(message.success);
                    break;
                case 'PROCESS_ERROR':
                    this.onProcessError(message.error);
                    break;
            }

            sendResponse({ received: true });
        });
    }

    startProcess() {
        console.log('[ClassSync UI] 開始執行流程');

        this.isRunning = true;
        this.updateStatus('執行中...', 'running');
        this.updateUI();

        chrome.runtime.sendMessage({
            type: 'START_CLASSSYNC',
            timestamp: Date.now()
        }).catch(error => {
            console.error('[ClassSync UI] 發送開始訊息失敗:', error);
            this.onProcessError('無法啟動自動化流程');
        });
    }

    stopProcess() {
        console.log('[ClassSync UI] 停止執行流程');

        this.isRunning = false;
        this.updateStatus('已停止', 'error');
        this.updateUI();

        chrome.runtime.sendMessage({
            type: 'STOP_CLASSSYNC',
            timestamp: Date.now()
        }).catch(error => {
            console.error('[ClassSync UI] 發送停止訊息失敗:', error);
        });
    }

    onProcessStarted() {
        console.log('[ClassSync UI] 流程已開始');
        this.isRunning = true;
        this.updateStatus('自動化執行中...', 'running');
        this.updateUI();
    }

    onProcessCompleted(success) {
        console.log('[ClassSync UI] 流程完成:', success);

        this.isRunning = false;

        if (success) {
            this.updateStatus('執行成功！', 'success');
        } else {
            this.updateStatus('執行失敗', 'error');
        }

        this.updateUI();
    }

    onProcessError(error) {
        console.error('[ClassSync UI] 流程錯誤:', error);

        this.isRunning = false;

        // 提供更友善的錯誤訊息
        const friendlyMessage = this.getFriendlyErrorMessage(error);
        this.updateStatus(friendlyMessage, 'error');
        this.updateUI();
    }

    getFriendlyErrorMessage(error) {
        const errorStr = error.toLowerCase();

        if (errorStr.includes('login') || errorStr.includes('登入')) {
            return '請先登入 1Campus 後再試';
        }

        if (errorStr.includes('page') || errorStr.includes('頁面') || errorStr.includes('載入')) {
            return '頁面載入異常，請重新整理後再試';
        }

        if (errorStr.includes('click') || errorStr.includes('點擊') || errorStr.includes('學習週曆')) {
            return '找不到學習週曆，請檢查頁面是否正常';
        }

        if (errorStr.includes('tschoolkit') || errorStr.includes('新分頁')) {
            return '無法開啟 tschoolkit，請檢查網路連線';
        }

        if (errorStr.includes('tab') || errorStr.includes('分頁') || errorStr.includes('待填下週')) {
            return 'tschoolkit 頁面異常，請手動重新載入';
        }

        if (errorStr.includes('modal') || errorStr.includes('form') || errorStr.includes('表單')) {
            return '無法開啟週曆填報表單，請手動點擊';
        }

        if (errorStr.includes('fill') || errorStr.includes('填寫')) {
            return '表單填寫失敗，請檢查資料格式';
        }

        if (errorStr.includes('submit') || errorStr.includes('提交')) {
            return '提交失敗，請檢查網路連線或手動提交';
        }

        if (errorStr.includes('timeout') || errorStr.includes('超時')) {
            return '操作超時，請重試或檢查網路連線';
        }

        // 預設錯誤訊息
        return '執行失敗，請重試或聯繫技術支援';
    }

    updateStatus(text, type = '') {
        const statusElement = document.getElementById('status');
        statusElement.textContent = text;
        statusElement.className = `status ${type}`;
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
}

// 初始化 UI
document.addEventListener('DOMContentLoaded', () => {
    console.log('[ClassSync UI] DOM 載入完成，初始化UI');
    new ClassSyncUI();
});