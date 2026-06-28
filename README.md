# AI案件獲得システム Ver2.0

クラウドワークスのAI関連案件を毎朝自動取得し、スマホで確認できるシステム。

## 毎朝の使い方

```
1. 朝PCを起動してログインする
2. バックグラウンドで案件取得が自動開始（約4〜5分）
3. Gmailに通知が届く
     件名：【今日の応募候補】S2件 A2件 6月29日
4. メール内のURLをタップしてスマホで案件確認
5. 気になる案件を3件「候補に追加」
6. 「ChatGPTへ共有」ボタンで応募文を一括作成
```

**スマホURL（ブックマーク推奨）：**
https://yuhki-013274.github.io/ai-job-finder/

---

## 仕組み

```
PC起動・ログイン
  ↓ 45秒後に自動実行（スタートアップ登録済み）
  ↓ クラウドワークス 13キーワード × 案件取得
  ↓ S/A/B/C で自動評価・10件に絞り込み
  ↓ GitHub Pages へ自動デプロイ
  ↓ Gmail 通知送信
スマホで確認
```

---

## ファイル構成

```
ai-job-finder/
  run.js              メイン処理
  scraper.js          クラウドワークス自動取得
  evaluator.js        案件評価ロジック
  config.js           キーワード・除外ルール（カスタマイズ用）
  renderer.js         HTML生成
  notifier.js         Gmail通知
  run-daily.bat       自動実行バッチ（ログイン時に起動）
  output/
    index.html        GitHub Pagesで公開されるHTML
    latest.html       ローカル確認用
  logs/
    run.log           実行ログ（トラブル時に確認）
```

---

## 手動実行

案件をすぐに更新したい場合：

```
run-daily.bat をダブルクリック
```

または PowerShell / コマンドプロンプトで：

```
cd C:\Users\nagam\projects\ai-job-finder
node run.js
```

---

## カスタマイズ

`config.js` を編集することで以下を変更できます：

- **検索キーワード追加** → `SEARCH_KEYWORDS` 配列に追加
- **除外ワード追加** → `EXCLUDE_PATTERNS` または `DOWNGRADE_PATTERNS` に追加
- **取得件数変更** → `MAX_JOBS: 10` の数字を変更

---

## トラブルシューティング

| 症状 | 確認場所 |
|---|---|
| Gmail が届かない | `logs\run.log` を確認 |
| 案件が0件 | ネット接続・クラウドワークスのメンテ確認 |
| GitHub Pages が更新されない | `git push` のエラーを `logs\run.log` で確認 |
| スタートアップで起動しない | `shell:startup` でショートカットの存在を確認 |
