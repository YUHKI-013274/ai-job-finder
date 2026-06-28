# AI案件獲得システム — Windows タスクスケジューラ設定
# 管理者権限で実行してください

$TaskName = "AI案件獲得システム_毎朝6時"
$ProjectDir = "C:\Users\nagam\projects\ai-job-finder"
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $NodePath) {
  Write-Error "Node.jsが見つかりません"
  exit 1
}

Write-Host "=== AI案件獲得システム タスクスケジューラ設定 ===" -ForegroundColor Cyan

# 既存タスクを削除
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "既存タスクを削除しました" -ForegroundColor Yellow
}

# バッチファイルパス
$BatchFile = Join-Path $ProjectDir "run-daily.bat"

# 実行バッチを作成
@"
@echo off
chcp 65001 > nul
cd /d "$ProjectDir"
node run.js >> "$ProjectDir\logs\run.log" 2>&1
"@ | Out-File -FilePath $BatchFile -Encoding ascii
Write-Host "実行バッチ作成: $BatchFile" -ForegroundColor Green

# ログフォルダ作成
New-Item -ItemType Directory -Force "$ProjectDir\logs" | Out-Null

# タスクのアクション
$Action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$BatchFile`"" `
  -WorkingDirectory $ProjectDir

# トリガー：毎朝5:50（スクレイピング+push+通知で約10分 → 6:00前後にGmail届く）
$Trigger = New-ScheduledTaskTrigger -Daily -At "5:50AM"

# 設定：スリープ解除・ログイン不要で実行
$Settings = New-ScheduledTaskSettingsSet `
  -WakeToRun `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -MultipleInstances IgnoreNew

# プリンシパル：現在のユーザーで実行
$Principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType S4U `
  -RunLevel Highest

# タスク登録
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description "毎朝5:50にクラウドワークスのAI案件を取得してGitHub PagesへデプロイしGmailで通知" `
  -Force | Out-Null

Write-Host ""
Write-Host "✅ タスク登録完了！" -ForegroundColor Green
Write-Host ""
Write-Host "設定内容:" -ForegroundColor Cyan
Write-Host "  タスク名  : $TaskName"
Write-Host "  実行時刻  : 毎朝 5:50 AM（PCがスリープ中でも自動起動）"
Write-Host "  ログファイル: $ProjectDir\logs\run.log"
Write-Host ""
Write-Host "今すぐテスト実行する場合:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""

# スリープ設定の確認
Write-Host "📌 PCのスリープ設定確認（重要）:" -ForegroundColor Yellow
Write-Host "  スタート → 電源とスリープ → スリープをオフ または"
Write-Host "  powercfg /change standby-timeout-ac 0   ← AC電源時スリープ無効"
Write-Host ""
Write-Host "  または hibernate を使う場合は WakeToRun が動作します。"
