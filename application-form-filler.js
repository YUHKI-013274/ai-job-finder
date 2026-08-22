// CrowdWorks応募フォームへ、Application Draft（data/private/application_drafts/{jobId}.json）の
// 内容を安全に入力するツール。
//
// ===== 絶対安全条件 =====
// このファイルは「入力」操作（fill・selectOption）のみを実装し、「送信」につながる操作は
// 一切実装しない。禁止：page.click()によるsubmit操作／form.submit()／
// リクエストAPIへの直接送信／Enterキー等キー入力による送信／JavaScript実行による
// submitイベント発火／応募ボタン要素への操作。regression-test.jsで、モックpageに対する
// 呼び出し内容の検証と、このファイル自体のソースコード走査の両方で機械的に保証する。
//
// フォームを開く操作（「応募する」を押す）も自動化しない。フォーム内の最終送信ボタンと
// 表示文言が同じ（value="応募する"）ため、文言でリンクを探して自動クリックすると
// 将来的な誤操作リスクになる。そのためゆうき自身に「応募する」を押してもらい、
// このツールはフォーム（#new_proposal）が表示されるのを待つだけにする。
//
// 実行は headless:false 固定。入力完了後もブラウザは閉じず、ゆうき自身が内容確認
// →応募ボタンを押す、という人の操作へ制御を渡す。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { loadApplicationDraft } = require('./application-draft-store');
const { loadApplicationPacket } = require('./application-packet-store');

const AUTH_STATE_PATH = path.join(__dirname, 'auth', 'crowdworks-state.json');
const FORM_WAIT_TIMEOUT_MS = 5 * 60 * 1000; // フォーム出現待ちの上限（ゆうきが「応募する」を押すのを待つ）

// ゆうきが実機で確認したCrowdWorks応募フォームのDOM（2026-08時点）。
const SELECTORS = {
  form: '#new_proposal',
  messageBody: '#proposal_conditions_attributes_0_message_attributes_body',
  // 表示用ダミー金額欄。IDに動的サフィックスが付く可能性があるが、この分岐は
  // Application Draftが確定金額を持つ場合のみ実行される（現行スキーマでは常に未実行）。
  amountDummy: '#amount_dummy_',
  amountInternal: '#proposal_conditions_attributes_0_milestones_attributes_0_amount_without_sales_tax',
  deadlineYear: '#proposal_conditions_attributes_0_milestones_attributes_0_deadline_1i',
  deadlineMonth: '#proposal_conditions_attributes_0_milestones_attributes_0_deadline_2i',
  deadlineDay: '#proposal_conditions_attributes_0_milestones_attributes_0_deadline_3i',
};

function isLoginUrl(url) {
  return /\/login(\/|$|\?)/.test(url || '');
}

// ===== 入力計画（純粋関数。Playwrightに依存せず単体テスト可能） =====
// Application Draftから「何を入力するか」を決定する。Draftに確定していない情報
// （契約金額・完了予定日）は一切推測せず、常にnull（未入力）として扱う。
// needs_confirmation／cannot_answerの質問は応募メッセージへ含めず、
// skippedQuestionsとしてゆうきの確認対象に残す（confirmationItems同様）。
function buildFillPlan(draft) {
  const readyAnswers = (draft.questionAnswers || []).filter(qa => qa.status === 'ready' && qa.answer);
  const skippedQuestions = (draft.questionAnswers || []).filter(qa => qa.status !== 'ready').map(qa => qa.question);

  const messageParts = [draft.applicationText || ''];
  readyAnswers.forEach(qa => {
    messageParts.push(`\n---\n${qa.question}\n${qa.answer}`);
  });

  return {
    jobId: draft.jobId,
    messageBody: messageParts.join('\n').trim(),
    // Application Draftは確定金額・確定完了予定日を保持しない設計のため、常に未入力とする
    // （募集条件のレンジ表示等から金額を推測して埋めることは絶対にしない）。
    amount: null,
    deliveryDate: null,
    skippedQuestions,
  };
}

// ===== フォームへの入力実行（許可された「入力」操作のみ） =====
async function applyFillPlan(page, fillPlan) {
  await page.fill(SELECTORS.messageBody, fillPlan.messageBody);

  if (fillPlan.amount !== null) {
    await page.fill(SELECTORS.amountDummy, String(fillPlan.amount));
    await page.fill(SELECTORS.amountInternal, String(fillPlan.amount));
  }
  // amountがnullの場合、契約金額欄には一切触れない
  // （「相談してから金額を提案」の選択も含め、フォームの初期状態のまま人に委ねる）。

  if (fillPlan.deliveryDate) {
    const [y, m, d] = fillPlan.deliveryDate.split('-');
    await page.selectOption(SELECTORS.deadlineYear, String(Number(y)));
    await page.selectOption(SELECTORS.deadlineMonth, String(Number(m)));
    await page.selectOption(SELECTORS.deadlineDay, String(Number(d)));
  }
  // deliveryDateがnullの場合、完了予定日欄には一切触れない。

  // 源泉徴収・添付ファイル・応募有効期間は、そもそもセレクタを保持せず対象外。
}

// ===== ロードと事前検証（Draft不足・jobId不一致はここで停止） =====
function loadFillContext(jobId) {
  const draft = loadApplicationDraft(jobId);
  if (!draft) {
    return { ok: false, reason: `Application Draft（data/private/application_drafts/${jobId}.json）が見つからない` };
  }
  if (draft.jobId !== jobId) {
    return { ok: false, reason: `Draft内のjobId（${draft.jobId}）が指定したjobId（${jobId}）と一致しない` };
  }
  const packet = loadApplicationPacket(jobId);
  if (!packet) {
    return { ok: false, reason: `Application Packet（data/private/application_packets/${jobId}.json）が見つからない` };
  }
  if (packet.jobId !== jobId) {
    return { ok: false, reason: `Packet内のjobId（${packet.jobId}）が指定したjobId（${jobId}）と一致しない` };
  }
  return { ok: true, draft, packet, fillPlan: buildFillPlan(draft) };
}

// ===== ページ操作本体（page注入可能。テストではモックpageを渡す） =====
// 「応募する」の押下はゆうき本人が行う想定のため、ここでは案件ページを開いて
// フォーム（#new_proposal）が現れるのを待つだけで、遷移用リンクの探索・クリックは行わない。
async function fillCrowdWorksForm(page, { jobId, jobUrl, fillPlan }) {
  await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });

  if (isLoginUrl(page.url())) {
    return { ok: false, reason: 'セッション切れ（ログイン画面へリダイレクトされました）。crowdworks-auth-setup.jsを再実行して再ログインしてください' };
  }
  if (!page.url().includes(String(jobId))) {
    return { ok: false, reason: `案件ページのURLに期待するjobId（${jobId}）が含まれていない` };
  }

  console.log(`案件ページを開きました。CrowdWorks上で「応募する」を押してフォームを表示してください（最大${Math.round(FORM_WAIT_TIMEOUT_MS / 60000)}分待機します）...`);
  try {
    await page.waitForSelector(SELECTORS.form, { timeout: FORM_WAIT_TIMEOUT_MS });
  } catch {
    return { ok: false, reason: '応募フォームが指定時間内に表示されませんでした（「応募する」が押されなかった可能性があります）' };
  }

  if (isLoginUrl(page.url())) {
    return { ok: false, reason: 'セッション切れ（フォーム表示待ち中にログイン画面へ遷移しました）。crowdworks-auth-setup.jsを再実行して再ログインしてください' };
  }

  await applyFillPlan(page, fillPlan);

  console.log('入力完了。内容を確認して、問題なければご自身で応募してください。');
  console.log(fillPlan.skippedQuestions.length > 0
    ? `未回答のまま残した質問（要ご確認）: ${fillPlan.skippedQuestions.length}件`
    : '未回答のまま残した質問はありません。');

  return { ok: true, fillPlan };
}

// ===== 実行本体（実ブラウザを起動する薄いラッパー） =====
async function runFormFiller(jobId) {
  const ctx = loadFillContext(jobId);
  if (!ctx.ok) return ctx;

  if (!fs.existsSync(AUTH_STATE_PATH)) {
    return { ok: false, reason: `認証セッション（${AUTH_STATE_PATH}）が見つからない。先にcrowdworks-auth-setup.jsを実行してください` };
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  const page = await context.newPage();

  const result = await fillCrowdWorksForm(page, { jobId, jobUrl: ctx.packet.job.url, fillPlan: ctx.fillPlan });
  // 成功・失敗に関わらずブラウザは閉じない（ゆうきが状況を確認できる状態を保つ）。
  return { ...result, browser, context, page };
}

module.exports = {
  AUTH_STATE_PATH,
  FORM_WAIT_TIMEOUT_MS,
  SELECTORS,
  isLoginUrl,
  buildFillPlan,
  applyFillPlan,
  loadFillContext,
  fillCrowdWorksForm,
  runFormFiller,
};

if (require.main === module) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('使い方: node application-form-filler.js <jobId>');
    process.exit(1);
  }
  runFormFiller(jobId).then(result => {
    if (!result.ok) {
      console.error(`❌ 停止しました: ${result.reason}`);
      process.exit(1);
    }
  }).catch(err => {
    console.error('エラー:', err.message);
    process.exit(1);
  });
}
