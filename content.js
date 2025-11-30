let lastActiveElement = null;

// ページ内のフォーカス移動を監視して、最後の入力要素を記憶する
document.addEventListener('focus', (event) => {
    const target = event.target;
    if (isInputable(target)) {
        lastActiveElement = target;
        // console.log('Active element updated:', target);
    }
}, true); // capture phaseでイベントを拾う

// 入力可能な要素か判定する
function isInputable(element) {
    if (!element) return false;
    const tagName = element.tagName;
    return (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        element.isContentEditable
    );
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getSelection") {
        const selection = window.getSelection().toString();
        sendResponse({ text: selection });
    }
    else if (request.action === "pasteText") {
        const success = insertTextToLastActiveElement(request.text);
        sendResponse({ success: success });
    }
    else if (request.action === "pasteImage") {
        insertImageToLastActiveElement(request.dataUrl).then(success => {
            sendResponse({ success: success });
        });
        return true; // 非同期レスポンスのためにtrueを返す
    }
});

// 画像を挿入する関数
async function insertImageToLastActiveElement(dataUrl) {
    let target = document.activeElement;
    if ((!target || target === document.body) && lastActiveElement) {
        target = lastActiveElement;
    }

    if (!target) return false;

    // 画像データをBlobに変換
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], "pasted_image.png", { type: "image/png" });

    // DataTransferオブジェクトを作成して画像をセット
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // pasteイベントを作成して発火
    const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
    });

    target.focus();
    target.dispatchEvent(pasteEvent);

    return true;
}

// テキストを挿入する関数
function insertTextToLastActiveElement(text) {
    // 現在のアクティブ要素を確認
    let target = document.activeElement;

    // もし現在のアクティブ要素がbodyなど（フォーカスが外れている）なら、記憶しておいた要素を使う
    if ((!target || target === document.body) && lastActiveElement) {
        target = lastActiveElement;
    }

    if (!isInputable(target)) {
        console.warn('テキストを挿入できる要素が見つかりません');
        return false;
    }

    // input または textarea の場合
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const value = target.value;

        target.value = value.substring(0, start) + text + value.substring(end);
        target.selectionStart = target.selectionEnd = start + text.length;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    // contenteditable の場合
    if (target.isContentEditable) {
        // フォーカスを戻す
        target.focus();
        document.execCommand('insertText', false, text);
        return true;
    }

    return false;
}

// --- 範囲選択キャプチャ機能 ---

let overlay = null;
let selectionBox = null;
let startX, startY;
let isSelecting = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startCapture") {
        createOverlay();
        sendResponse({ status: "started" });
    }
});

function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    overlay.style.zIndex = '999999';
    overlay.style.cursor = 'crosshair';
    overlay.style.userSelect = 'none';

    selectionBox = document.createElement('div');
    selectionBox.style.position = 'fixed';
    selectionBox.style.border = '2px solid #0078d4';
    selectionBox.style.backgroundColor = 'rgba(0, 120, 212, 0.1)';
    selectionBox.style.display = 'none';
    overlay.appendChild(selectionBox);

    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
}

function removeOverlay() {
    if (overlay) {
        overlay.remove();
        overlay = null;
        selectionBox = null;
    }
    document.removeEventListener('keydown', onKeyDown);
}

function onKeyDown(e) {
    if (e.key === 'Escape') {
        removeOverlay();
    }
}

function onMouseDown(e) {
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';

    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e) {
    if (!isSelecting) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
}

function onMouseUp(e) {
    isSelecting = false;
    overlay.removeEventListener('mousemove', onMouseMove);
    overlay.removeEventListener('mouseup', onMouseUp);

    const rect = selectionBox.getBoundingClientRect();
    const area = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        devicePixelRatio: window.devicePixelRatio
    };

    removeOverlay();

    // 範囲が小さすぎる場合は無視
    if (area.width < 5 || area.height < 5) return;

    // Popupに座標を送る
    chrome.runtime.sendMessage({
        action: "captureSelected",
        area: area
    });
}
