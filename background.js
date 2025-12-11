// サイドパネルの挙動を設定する関数
function setupSidePanel() {
    // アイコンクリックでサイドパネルを開くように設定
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error("SidePanel setup error:", error));
}

// タブの履歴管理（直前のタブを特定するため）
let tabHistory = [];

chrome.tabs.onActivated.addListener((activeInfo) => {
    // 履歴の末尾に追加
    tabHistory.push(activeInfo.tabId);
    // 履歴が長くなりすぎないように調整（最大10件）
    if (tabHistory.length > 10) {
        tabHistory.shift();
    }
});

// タブが閉じられたら履歴から削除
chrome.tabs.onRemoved.addListener((tabId) => {
    tabHistory = tabHistory.filter(id => id !== tabId);
});

// Popupからの問い合わせに応答
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getLastTabId") {
        // 履歴の後ろから探す（自分自身＝sender.tab.id を除外）
        const currentTabId = sender.tab ? sender.tab.id : null;
        let targetId = null;

        for (let i = tabHistory.length - 1; i >= 0; i--) {
            if (tabHistory[i] !== currentTabId) {
                targetId = tabHistory[i];
                break;
            }
        }
        sendResponse({ tabId: targetId });
    }
});

// インストール時と起動時に設定を適用
chrome.runtime.onInstalled.addListener(setupSidePanel);
chrome.runtime.onStartup.addListener(setupSidePanel);

// スクリプト読み込み時にも実行（開発中のリロード対策）
setupSidePanel();
