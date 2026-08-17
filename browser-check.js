// Playwrightのブラウザバイナリが揃っているかを、日次実行の最初（scraper.js/detail-scraper.jsが
// chromium.launch()を呼ぶより前）に確認する。scraper.js・detail-scraper.jsはどちらも
// chromium.launch({ headless: true })（channel指定なし）のみを使うため、Chromiumだけを対象とする。
//
// 正常時：実際に起動テストを1回行い（ページ遷移はしない＝ネットワーク通信なし）、
//   即座にブラウザを閉じて終了する。追加の処理は行わない。
// バイナリ不足・破損時：`npx playwright install chromium` による自動復旧を1回だけ試みる。
//   復旧後に再度起動テストを行い、成功すれば継続、失敗すれば失敗理由を返す
//   （呼び出し側で通知・ログ出力・処理停止を判断する。ここでは無言で握りつぶさない）。
const { chromium } = require('playwright');
const { execSync } = require('child_process');

async function tryLaunch() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message.split('\n')[0] };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// runInstallはテスト用の差し替え口（既定は実際のインストールコマンドを実行する）。
async function ensureBrowserAvailable({ runInstall } = {}) {
  const first = await tryLaunch();
  if (first.ok) {
    return { ok: true, recovered: false, error: null };
  }

  console.log(`⚠️  Playwrightのブラウザ起動に失敗しました（${first.error}）。'npx playwright install chromium' による自動復旧を試みます...`);

  try {
    if (runInstall) {
      await runInstall();
    } else {
      execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 5 * 60 * 1000 });
    }
  } catch (installErr) {
    return {
      ok: false,
      recovered: false,
      error: `自動インストールに失敗しました: ${installErr.message.split('\n')[0]}（初回起動エラー: ${first.error}）`,
    };
  }

  const second = await tryLaunch();
  if (second.ok) {
    console.log('✅ Playwrightブラウザの自動復旧に成功しました');
    return { ok: true, recovered: true, error: null };
  }

  return {
    ok: false,
    recovered: false,
    error: `自動インストール後も起動できません: ${second.error}（初回起動エラー: ${first.error}）`,
  };
}

module.exports = { ensureBrowserAvailable, tryLaunch };
