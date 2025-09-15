// 載入並顯示當前設定
document.addEventListener('DOMContentLoaded', async () => {
    const result = await chrome.storage.sync.get(['defaultLocation']);
    const defaultLocation = result.defaultLocation || '弘道基地';

    document.getElementById('defaultLocation').value = defaultLocation;
});

// 儲存設定
document.getElementById('saveSettings').addEventListener('click', async () => {
    const defaultLocation = document.getElementById('defaultLocation').value;

    await chrome.storage.sync.set({
        defaultLocation: defaultLocation
    });

    // 顯示儲存成功訊息
    const status = document.getElementById('status');
    status.textContent = '設定已儲存！';
    status.className = 'status success';
    status.style.display = 'block';

    // 3秒後隱藏訊息
    setTimeout(() => {
        status.style.display = 'none';
    }, 3000);
});