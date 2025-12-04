#!/bin/bash

# 現在の日時を取得 (例: 2025-12-04 13:00)
CURRENT_DATE=$(date "+%Y-%m-%d %H:%M")

# version.js を更新
echo "Updating version to: $CURRENT_DATE"
echo "const APP_VERSION = \"$CURRENT_DATE\";" > version.js
echo "// このファイルはスクリプトによって自動更新されます" >> version.js

# Git 操作
echo "Committing and pushing..."
git add .
git commit -m "Update version to $CURRENT_DATE and push changes"
git push

echo "Done! Pushed version $CURRENT_DATE"
