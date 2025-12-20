document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const fetchModelsButton = document.getElementById('fetchModels');
    const saveButton = document.getElementById('save');
    const status = document.getElementById('status');

    // 保存されている設定を読み込む
    chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'cachedModelList'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }

        // キャッシュされたモデルリストがあれば復元
        if (result.cachedModelList && result.cachedModelList.length > 0) {
            updateModelDropdown(result.cachedModelList, result.geminiModel);
        } else if (result.geminiModel) {
            // リストはないが選択済みモデルがある場合（手動設定など）
            // デフォルトの選択肢に追加して選択状態にする
            const option = document.createElement('option');
            option.value = result.geminiModel;
            option.textContent = result.geminiModel;
            modelSelect.appendChild(option);
            modelSelect.value = result.geminiModel;
        }
    });

    // モデル一覧更新ボタン
    fetchModelsButton.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            showStatus('先にAPIキーを入力してください', false);
            return;
        }

        fetchModelsButton.textContent = "更新中...";
        fetchModelsButton.disabled = true;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (!response.ok) throw new Error('Failed to fetch models');

            const data = await response.json();

            // generateContentに対応しているモデルのみ抽出
            const contentModels = data.models
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                .map(m => m.name.replace("models/", "")); // "models/gemini-pro" -> "gemini-pro"

            // プルダウン更新
            updateModelDropdown(contentModels);

            // リストをキャッシュ保存
            chrome.storage.local.set({ cachedModelList: contentModels });

            showStatus('モデル一覧を更新しました', true);

        } catch (error) {
            console.error(error);
            showStatus('モデル一覧の取得に失敗しました', false);
        } finally {
            fetchModelsButton.textContent = "一覧更新";
            fetchModelsButton.disabled = false;
        }
    });

    // プルダウン更新ヘルパー
    function updateModelDropdown(models, selectedValue = null) {
        modelSelect.innerHTML = ''; // クリア

        // デフォルトを最初に追加（念のため）
        // if (!models.includes('gemini-2.5-flash')) {
        //     const defaultOpt = document.createElement('option');
        //     defaultOpt.value = 'gemini-2.5-flash';
        //     defaultOpt.textContent = 'gemini-2.5-flash (Default)';
        //     modelSelect.appendChild(defaultOpt);
        // }

        models.forEach(modelName => {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            modelSelect.appendChild(option);
        });

        if (selectedValue && models.includes(selectedValue)) {
            modelSelect.value = selectedValue;
        }
    }

    // 保存ボタンの処理
    saveButton.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const model = modelSelect.value;

        if (!key) {
            showStatus('APIキーを入力してください', false);
            return;
        }

        chrome.storage.local.set({
            geminiApiKey: key,
            geminiModel: model
        }, () => {
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
