document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('editor');
    const btnGetSelection = document.getElementById('btn-get-selection');
    const btnPaste = document.getElementById('btn-paste');
    const status = document.getElementById('status');

    // ユーティリティ: ステータス表示
    const showStatus = (msg, duration = 2000) => {
        status.textContent = msg;
        setTimeout(() => {
            status.textContent = '';
        }, duration);
    };

    // 1. ポップアップを開いた時に、自動で選択範囲を取得を試みる
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "getSelection" }, (response) => {
                if (chrome.runtime.lastError) {
                    // エラーは無視（Content Scriptがまだロードされていないページなど）
                    return;
                }
                if (response && response.text) {
                    editor.value = response.text;
                    showStatus('選択テキストを取得しました');
                }
            });
        }
    });

    // ボタン: 選択範囲を再取得
    btnGetSelection.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: "getSelection" }, (response) => {
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
        const textToPaste = editor.value;
        if (!textToPaste) {
            showStatus('テキストが空です');
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            // タブが見つからない場合
            if (!tabs || tabs.length === 0) {
                showStatus('対象のタブが見つかりません');
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, {
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
    const capturedImagesContainer = document.getElementById('captured-images');

    btnCapture.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: "startCapture" }, () => {
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
            chrome.windows.getLastFocused((window) => {
                if (!window) return;
                chrome.tabs.query({ active: true, windowId: window.id }, (tabs) => {
                    if (!tabs[0]) {
                        showStatus('タブが見つかりません');
                        return;
                    }

                    chrome.tabs.sendMessage(tabs[0].id, {
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
});
