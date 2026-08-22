// CrowdWorksへのログインセッションを、application-form-filler.js が使える形（Playwrightの
// storageState）でローカルに保存するための、一度きりの手動セットアップ用スクリプト。
//
// このスクリプトはID・パスワードを一切読み書きしない。ゆうき自身が画面上で手動ログインし、
// その結果のCookie等（storageState）だけをローカルファイルへ保存する。
// 保存先（auth/crowdworks-state.json）は.gitignoreで除外済みで、コミット・pushされない。
//
// 使い方: node crowdworks-auth-setup.js
//   1. 表示されたブラウザでCrowdWorksに手動でログインする
//   2. ログインできたら、このターミナルでEnterキーを押す
//   3. auth/crowdworks-state.json が保存されて終了する
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

const AUTH_DIR = path.join(__dirname, 'auth');
const AUTH_STATE_PATH = path.join(AUTH_DIR, 'crowdworks-state.json');
const LOGIN_URL = 'https://crowdworks.jp/login';

function waitForEnter(promptText) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  console.log('CrowdWorksのログイン画面を開きます（このスクリプトはID・パスワードを扱いません）。');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  await waitForEnter('\nブラウザで手動ログインを完了したら、このターミナルでEnterキーを押してください... ');

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`✅ ログインセッションを保存しました: ${AUTH_STATE_PATH}`);
  console.log('このファイルはID・パスワードそのものではありませんが、ログイン済みセッションを再現できる情報です。他人と共有しないでください。');

  await browser.close();
}

if (require.main === module) {
  main().catch(err => {
    console.error('エラー:', err.message);
    process.exit(1);
  });
}

module.exports = { AUTH_STATE_PATH, LOGIN_URL };
