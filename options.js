document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveButton = document.getElementById('save');
    const status = document.getElementById('status');

    // 保存されているキーを読み込む
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
    });

    // 保存ボタンの処理
    saveButton.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();

        if (!key) {
            showStatus('APIキーを入力してください', false);
            return;
        }

        chrome.storage.local.set({ geminiApiKey: key }, () => {
            showStatus('設定を保存しました', true);
        });
    });

    function showStatus(msg, isSuccess) {
        status.textContent = msg;
        status.style.color = isSuccess ? 'green' : 'red';
        setTimeout(() => {
            status.textContent = '';
        }, 3000);
    }
});
