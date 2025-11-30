// サイドパネルの挙動を設定する関数
function setupSidePanel() {
    // アイコンクリックでサイドパネルを開くように設定
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error("SidePanel setup error:", error));
}

// インストール時と起動時に設定を適用
chrome.runtime.onInstalled.addListener(setupSidePanel);
chrome.runtime.onStartup.addListener(setupSidePanel);

// スクリプト読み込み時にも実行（開発中のリロード対策）
setupSidePanel();
