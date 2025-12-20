document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('editor');
    const capturedImagesContainer = document.getElementById('captured-images');
    const btnGetSelection = document.getElementById('btn-get-selection'); // 追加
    const btnPaste = document.getElementById('btn-paste');
    const status = document.getElementById('status');

    // バージョン表示 (version.jsで定義されたAPP_VERSIONを使用)
    if (typeof APP_VERSION !== 'undefined') {
        document.getElementById('app-version').textContent = APP_VERSION + "版";
    }

    // ユーティリティ: ステータス表示
    const showStatus = (msg, duration = 9999, isError = false) => {
        status.textContent = msg;
        status.style.color = isError ? '#ff6b6b' : '#888'; // エラーなら赤色

        // エラーの場合は自動で消さない
        if (isError) {
            // 何もしない（永続表示）
        } else {
            setTimeout(() => {
                status.textContent = '';
            }, duration);
        }
    };

    // ターゲットタブを特定する関数
    const getTargetTab = (callback) => {
        // 1. まずは現在のウィンドウのアクティブタブを確認
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];

            // 拡張機能のページ自体でないなら、それがターゲット（サイドパネル利用時など）
            if (currentTab && !currentTab.url.startsWith('chrome-extension://')) {
                callback(currentTab);
                return;
            }

            // 2. 自分が拡張機能ページなら、Background Scriptに直前のタブIDを聞く
            chrome.runtime.sendMessage({ action: "getLastTabId" }, (response) => {
                if (response && response.tabId) {
                    chrome.tabs.get(response.tabId, (tab) => {
                        if (chrome.runtime.lastError) {
                            // タブが既に閉じられている場合など
                            callback(null);
                        } else {
                            callback(tab);
                        }
                    });
                } else {
                    callback(null);
                }
            });
        });
    };

    // 1. ポップアップを開いた時に、自動で選択範囲を取得を試みる
    getTargetTab((tab) => {
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: "getSelection" }, (response) => {
                if (chrome.runtime.lastError) return;
                if (response && response.text) {
                    editor.value = response.text;
                    showStatus('選択テキストを取得しました');
                }
            });
        }
    });

    // ボタン: 選択範囲を再取得
    btnGetSelection.addEventListener('click', () => {
        getTargetTab((tab) => {
            if (!tab) {
                showStatus('対象のタブが見つかりません');
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: "getSelection" }, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus('エラー: ページをリロードしてください');
                    return;
                }
                if (response && response.text) {
                    editor.value = response.text;
                    showStatus('取得しました');
                } else {
                    showStatus('選択範囲が見つかりません');
                }
            });
        });
    });

    // ボタン: ページに貼り付け
    btnPaste.addEventListener('click', () => {
        // 修正結果があればそれを、なければ元のテキストを貼り付ける
        const textToPaste = resultEditor.value || editor.value;

        if (!textToPaste || textToPaste === "生成中..." || textToPaste === "エラーが発生しました") {
            showStatus('貼り付けるテキストがありません');
            return;
        }

        getTargetTab((tab) => {
            if (!tab) {
                showStatus('対象のタブが見つかりません');
                return;
            }

            chrome.tabs.sendMessage(tab.id, {
                action: "pasteText",
                text: textToPaste
            }, (response) => {
                // 通信エラー（Content Scriptがいない、リロードしていないなど）
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                    showStatus('エラー: ページをリロードしてください', 3000);
                    return;
                }

                // 処理結果の判定
                if (response && response.success) {
                    showStatus('貼り付けました！');
                } else {
                    showStatus('貼り付け先が見つかりません。入力欄をクリックしてください', 3000);
                }
            });
        });
    });

    // --- キャプチャ機能 ---
    const btnCapture = document.getElementById('btn-capture');
    // capturedImagesContainerは冒頭で宣言済み（にする）

    btnCapture.addEventListener('click', () => {
        getTargetTab((tab) => {
            if (!tab) {
                showStatus('キャプチャ対象が見つかりません');
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: "startCapture" }, () => {
                if (chrome.runtime.lastError) {
                    showStatus('エラー: ページをリロードしてください');
                } else {
                    // サイドパネルを閉じてしまわないように、ここでは何もしない
                    // ユーザーが選択を完了するのを待つ
                }
            });
        });
    });

    // Content Scriptからのメッセージ受信（範囲選択完了）
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "captureSelected") {
            captureAndCrop(request.area);
        }
    });

    function captureAndCrop(area) {
        // lastFocusedWindowオプションの挙動が不安定なため、
        // chrome.windows APIを使って明示的にフォーカスされたウィンドウを取得する
        chrome.windows.getLastFocused((window) => {
            if (chrome.runtime.lastError || !window) {
                console.error("Window get error:", chrome.runtime.lastError);
                // フォールバック: 全ウィンドウからアクティブタブを探す
                fallbackCapture(area);
                return;
            }

            const windowId = window.id;

            // 取得したウィンドウID内のアクティブタブを探す
            chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    // タブが見つからない場合もフォールバック
                    fallbackCapture(area);
                    return;
                }
                executeCapture(windowId, area);
            });
        });
    }

    function fallbackCapture(area) {
        chrome.tabs.query({ active: true }, (allTabs) => {
            if (allTabs.length > 0) {
                executeCapture(allTabs[0].windowId, area);
            } else {
                showStatus('キャプチャ対象のタブが見つかりません');
            }
        });
    }

    function executeCapture(windowId, area) {
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                showStatus('キャプチャ失敗: ' + chrome.runtime.lastError.message, 5000);
                return;
            }
            cropImage(dataUrl, area);
        });
    }

    function cropImage(dataUrl, area) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            // デバイスピクセル比を考慮
            const dpr = area.devicePixelRatio || 1;

            canvas.width = area.width * dpr;
            canvas.height = area.height * dpr;

            // 画像から指定範囲を切り抜く
            // sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight
            ctx.drawImage(
                img,
                area.x * dpr, area.y * dpr, area.width * dpr, area.height * dpr,
                0, 0, canvas.width, canvas.height
            );

            const croppedDataUrl = canvas.toDataURL('image/png');
            addCapturedImage(croppedDataUrl);
        };

        img.src = dataUrl;
    }

    function addCapturedImage(dataUrl) {
        const div = document.createElement('div');
        div.className = 'captured-image-item';

        const img = document.createElement('img');
        img.src = dataUrl;

        // 削除ボタン
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '×';
        removeBtn.title = '削除';
        removeBtn.onclick = () => div.remove();

        // 貼り付けボタン
        const pasteBtn = document.createElement('button');
        pasteBtn.className = 'paste-img-btn';
        pasteBtn.innerHTML = '📋 貼り付け';
        pasteBtn.title = 'ページに画像を貼り付け';
        pasteBtn.onclick = (e) => {
            e.stopPropagation(); // 画像クリック（コピー）の発火を防ぐ

            // アクティブなタブを探して送信
            getTargetTab((tab) => {
                if (!tab) {
                    showStatus('タブが見つかりません');
                    return;
                }

                chrome.tabs.sendMessage(tab.id, {
                    action: "pasteImage",
                    dataUrl: dataUrl
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        showStatus('エラー: ページをリロードしてください');
                    } else if (response && response.success) {
                        showStatus('画像を貼り付けました！');
                    } else {
                        showStatus('失敗: リッチテキスト入力欄を選択してください', 3000);
                    }
                });
            });
        };

        // 画像をクリックしたらクリップボードにコピー
        img.onclick = async () => {
            try {
                const blob = await (await fetch(dataUrl)).blob();
                await navigator.clipboard.write([
                    new ClipboardItem({
                        [blob.type]: blob
                    })
                ]);
                showStatus('クリップボードにコピーしました');
            } catch (err) {
                console.error(err);
                showStatus('コピーに失敗しました');
            }
        };
        img.style.cursor = 'pointer';
        img.title = 'クリックしてクリップボードにコピー';

        div.appendChild(img);
        div.appendChild(removeBtn);
        div.appendChild(pasteBtn);
        capturedImagesContainer.prepend(div);
    }

    // --- AI機能 ---
    const btnAiRun = document.getElementById('btn-ai-run');
    const aiModeSelect = document.getElementById('ai-mode');
    const resultEditor = document.getElementById('result-editor');
    const instructionEditor = document.getElementById('instruction-editor'); // 追加
    const btnCopyResult = document.getElementById('btn-copy-result');
    const btnClearAll = document.getElementById('btn-clear-all'); // 追加

    // 結果コピーボタン
    btnCopyResult.addEventListener('click', async () => {
        const text = resultEditor.value;
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            showStatus('結果をコピーしました！');
        } catch (err) {
            console.error(err);
            showStatus('コピー失敗');
        }
    });

    // 全てクリアボタン
    btnClearAll.addEventListener('click', () => {
        editor.value = '';
        instructionEditor.value = '140文字以内で回答してください'; // 初期値に戻す
        resultEditor.value = '';
        lastConversation = null; // 履歴もリセット
        showStatus('クリアしました');
    });

    // ショートカットキーの実装 (Ctrl+Enter or Cmd+Enter)
    const handleShortcut = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault(); // 改行が入らないようにする
            btnAiRun.click();   // AI実行ボタンを押す
        }
    };

    editor.addEventListener('keydown', handleShortcut);
    instructionEditor.addEventListener('keydown', handleShortcut);
    aiModeSelect.addEventListener('keydown', handleShortcut); // プルダウンでも実行可能に

    // 直前の会話履歴を保持する変数（素通しモード用）
    let lastConversation = null;

    btnAiRun.addEventListener('click', async () => {
        const text = editor.value;
        const instruction = instructionEditor.value; // 追加指示

        if (!text && !instruction) {
            showStatus('テキストまたは指示を入力してください');
            return;
        }

        // APIキーとモデル名の取得
        const { geminiApiKey, geminiModel } = await chrome.storage.local.get(['geminiApiKey', 'geminiModel']);
        if (!geminiApiKey) {
            showStatus('設定画面でAPIキーを設定してください', 3000);
            // オプションページを開く
            chrome.runtime.openOptionsPage();
            return;
        }

        // モデル名が未設定ならデフォルトを使用
        const selectedModel = geminiModel || "gemini-2.5-flash";

        const mode = aiModeSelect.value;
        let prompt = "";
        let history = []; // APIに送る履歴

        // モードが変わったら履歴をリセットするなどの制御も可能だが、
        // 今回は「素通しモード」以外なら履歴を使わない（リセットはしないが送らない）方針
        if (mode !== "free_ask") {
            lastConversation = null; // 他のモードを使ったら文脈を切る
        }

        switch (mode) {
            case "x_post":
                prompt = `
あなたは以下の【投稿スタイル】を持つユーザーの専属ライターです。
【入力文】を元に、このユーザーらしいX（旧Twitter）の投稿文を作成してください。
【追加指示】があれば、それも反映してください。

# 投稿スタイル
- 前向きでポジティブなメッセージを発信する
- IT技術や現場の知見を、明るく共有するスタイル
- 読者が「なるほど」「やってみよう」と思えるような口調

# 制約事項
- 140文字以内に収めること
- 適切な改行を入れること
- 【入力文】の中にある「」や""で囲まれた部分は、変更せずにそのまま使用すること
- 以下のハッシュタグを文末に必ず含めること
  - #it祈祷師

【入力文】:
${text}

【追加指示】:
${instruction}

出力は投稿文のみにしてください。
`.trim();
                break;
            case "x_post_genba":
                prompt = `
あなたは以下の【投稿スタイル】を持つユーザーの専属ライターです。
【入力文】を元に、このユーザーらしいX（旧Twitter）の投稿文を作成してください。
【追加指示】があれば、それも反映してください。

# 投稿スタイル
- 現場の課題やリアリティを的確に切り取る
- 綺麗事ではなく、実務的な視点で事象を捉える
- 読者が「あるある」「わかる」と共感できるような口調
- 基本的な文体は「です・ます」調などで、丁寧かつフラットに

# 制約事項
- 140文字以内に収めること
- 適切な改行を入れること
- 【入力文】の中にある「」や""で囲まれた部分は、変更せずにそのまま使用すること
- 以下のハッシュタグを文末に必ず含めること
  - #現場からは以上です

【入力文】:
${text}

【追加指示】:
${instruction}

出力は投稿文のみにしてください。
`.trim();
                break;
            case "free_ask":
                // 素通しモード：入力テキストをそのまま送る
                prompt = text;
                if (instruction) {
                    prompt += "\n\n" + instruction;
                }

                // 直前の履歴があればセットする
                if (lastConversation) {
                    history = [
                        { role: "user", parts: [{ text: lastConversation.user }] },
                        { role: "model", parts: [{ text: lastConversation.model }] }
                    ];
                }
                break;
            case "fix_grammar":
                prompt = "以下のテキストの誤字脱字を修正し、自然な日本語に直してください。結果のみを出力してください:\n\n" + text;
                break;
            case "polite":
                prompt = "以下のテキストを、ビジネスメールでも使えるような丁寧な敬語に書き換えてください。結果のみを出力してください:\n\n" + text;
                break;
            case "summarize":
                prompt = "以下のテキストを簡潔に要約してください:\n\n" + text;
                break;
            case "translate_en":
                prompt = "Translate the following text into natural English:\n\n" + text;
                break;
            case "translate_ja":
                prompt = "以下のテキストを自然な日本語に翻訳してください:\n\n" + text;
                break;
        }

        // ローディング表示
        const originalBtnText = btnAiRun.textContent;
        btnAiRun.textContent = "生成中...";
        btnAiRun.disabled = true;
        resultEditor.value = "生成中..."; // 結果エリアにも表示

        try {
            // 履歴(history)も渡すように変更
            const result = await callGeminiApi(geminiApiKey, selectedModel, prompt, history);
            if (result) {
                resultEditor.value = result; // 結果エリアに表示
                showStatus('AI生成完了！');

                // 素通しモードなら、今回のやり取りを履歴として保存
                if (mode === "free_ask") {
                    lastConversation = {
                        user: prompt,
                        model: result
                    };
                }
            } else {
                resultEditor.value = "";
                showStatus('生成に失敗しました');
            }
        } catch (error) {
            console.error(error);
            alert("詳細エラー: " + error.message); // デバッグ用アラート
            resultEditor.value = "エラーが発生しました";
            showStatus('エラー: ' + error.message, 0, true);
        } finally {
            btnAiRun.textContent = originalBtnText;
            btnAiRun.disabled = false;
        }
    });

    // history引数を追加
    async function callGeminiApi(apiKey, modelName, prompt, history = []) {
        // ユーザー指定のモデルを使用
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        // 現在のプロンプトをメッセージ形式に変換
        const currentMessage = {
            role: "user",
            parts: [{ text: prompt }]
        };

        // 履歴と現在のメッセージを結合
        const contents = [...history, currentMessage];

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: contents
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'API Error');
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    }
});
