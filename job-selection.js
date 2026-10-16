// 案件選定の最終整理。
//   1. 同一発注者の連番募集（同じテンプレートの募集）を1件に集約する
//   2. Stage1（案件全文の分析）の結果を4分類（今応募／要確認／育成候補／対象外）に反映する
//   3. 主力の「今応募」が少ない日は、応募条件を満たすライティング等の収益・実績候補で補充する
//   4. 全文判定で脱落した分を補うため、後続候補の詳細取得プールを選ぶ
//
// 評価スコア・重み・Knowledgeは変更しない（evaluator.jsの結果を前提に、Stage1の事実で振り直すだけ）。
// 4分類:
//   今応募  … 戦略適合・資格不一致なし・応募に必要な条件／提出物を満たしている
//   要確認  … 応募可否や契約条件に関わる重要事項が未確認（年齢条件・特殊な応募方式・稼働条件・報酬未確認 等）
//   育成候補… 戦略に合うが、応募に必要な作品・実績・能力が不足している（不足と補う行動を表示）
//   対象外  … 戦略外・明確な資格不一致・重大リスク（Stage1が見送り）・連番募集の集約
// ツール使用経験の未確認、必須条件の自動抽出不可などの軽微な確認事項だけで「今応募」から外さない。
const { loadJobAnalysis } = require('./analysis-store');

const MIN_MAIN = 5;      // 主力の「今応募」がこれ未満なら収益・実績候補で補充する
const MAIN_TARGET = 10;  // 見送りで減った分を後続候補で補充する目標件数（既存のMAX_JOBSと同じ）
const MAX_GROWTH = 15;
const REVENUE_CATEGORY_IDS = ['seo_article', 'btob_writing']; // 収益・実績確保領域（AIライティング・記事・BtoBライティング）
const STRONG_EVIDENCE = ['直接証明', '強い代替証明'];
const RANK_ORDER = { S: 0, A: 1, B: 2, C: 3 };

const SERIAL_REASON = '同一発注者の連番募集（集約）';

function byRankThenScore(a, b) {
  const d = (RANK_ORDER[a.rank] ?? 9) - (RANK_ORDER[b.rank] ?? 9);
  return d !== 0 ? d : (b.totalScore || 0) - (a.totalScore || 0);
}

// 表示件数で切り詰める前の全評価済み案件（evaluator.classifyJobsのallEvaluated）から、
// 除外・保留を除いた候補を、既存の表示区分（displayTier）ごとの配列にまとめる（評価順）。
function buildUncappedState(allEvaluated) {
  const state = { nowApply: [], highValueChallenge: [], normalChallenge: [], confirmCandidates: [], excluded: [] };
  const target = {
    now: 'nowApply', now_pending: 'nowApply', high_value_challenge: 'highValueChallenge',
    normal_challenge: 'normalChallenge', confirm_candidate: 'confirmCandidates',
  };
  for (const job of allEvaluated) {
    if (job.excluded) continue;
    const key = target[job.displayTier];
    if (key) state[key].push(job);
  }
  for (const key of ['nowApply', 'highValueChallenge', 'normalChallenge', 'confirmCandidates']) state[key].sort(byRankThenScore);
  return state;
}

// ===== 1. 連番募集の集約 =====
function normTitle(t) { return String(t || '').replace(/\s+/g, ''); }
function commonPrefixLen(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }
function commonSuffixLen(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; }

// 先頭10字以上かつ末尾10字以上が一致するタイトル＝同じテンプレートの募集（実データ約600件で、
// 別案件の誤集約が出ない水準に調整済み）。報酬表記が両方あり異なる場合は別案件として扱う。
function isSerialPair(a, b) {
  const x = normTitle(a.title), y = normTitle(b.title);
  if (!x || !y) return false;
  if (a.price && b.price && a.price !== '要確認' && b.price !== '要確認' && a.price !== b.price) return false;
  if (x === y) return true;
  return commonPrefixLen(x, y) >= 10 && commonSuffixLen(x, y) >= 10;
}

// buckets：優先順に並んだ配列の配列（今すぐ応募→高単価→通常→確認候補）。各配列は評価順でソート済みの前提で、
// 先に現れた案件を代表として残し、同じテンプレートの後続案件を除外へ移す（配列は破壊的に更新する）。
function collapseSerialPostings(buckets, excluded) {
  const representatives = [];
  const collapsed = [];
  for (const bucket of buckets) {
    for (let i = 0; i < bucket.length; i++) {
      const job = bucket[i];
      const rep = representatives.find(r => isSerialPair(r.job, job));
      if (!rep) { representatives.push({ job, count: 1 }); continue; }
      rep.count++;
      bucket.splice(i, 1);
      i--;
      const out = {
        ...job, excluded: true, excludeReason: SERIAL_REASON,
        skipReason: `同じテンプレートの連番募集のため代表案件（${rep.job.id}）に集約`,
        finalClass: '対象外',
      };
      excluded.push(out);
      collapsed.push(out);
    }
  }
  return collapsed;
}

// ===== 2. 4分類 =====
const GROWTH_BY_CATEGORY = {
  seo_article: {
    shortage: '記事の外部受注実績が少ない（受注はテストライティング1件、成果物は自主制作5記事）',
    action: '小口の記事案件で受注実績を1件積む。応募時はライティングポートフォリオ（/writing）の記事を添える',
  },
  canva_design: {
    shortage: '外部の納品済みCanva・情報設計の実績が少ない（AI画像5作品と、納品前の契約1件）',
    action: '案件に近いテーマのサンプルを1点自主制作し、画像制作ポートフォリオ（/design）に追加してから応募する',
  },
  whitepaper_service: {
    shortage: 'ホワイトペーパー・サービス資料の成果物が未登録',
    action: 'サービス紹介資料のサンプルを1点自主制作し、資料制作ポートフォリオ（/improvement）に追加してから応募する',
  },
  sns_single_image: {
    shortage: 'SNS単発画像の納品済み実績が少ない（AI画像5作品と、納品前の契約1件）',
    action: 'SNS向け単発画像のサンプルを1点自主制作し、画像制作ポートフォリオ（/design）に追加してから応募する',
  },
};
const GROWTH_DEFAULT_ACTION = 'この案件に近い自主制作サンプルを1点作り、ポートフォリオに追加してから応募する';

function importantConfirmItems(job, analysis, signals) {
  const items = [];
  if (signals) {
    if (signals.age && signals.age.level === 'hard') items.push(`年齢条件：${signals.age.excerpt}（本人が該当するか確認）`);
    if (signals.specialApply && signals.specialApply.detected) items.push(`特殊な応募方式：${signals.specialApply.excerpts.join(' / ')}`);
    if (signals.workConstraint && signals.workConstraint.detected) items.push(`稼働条件：${signals.workConstraint.excerpts.join(' / ')}（対応可否を確認）`);
  }
  if (signals && signals.requiredExperience && signals.requiredExperience.detected) {
    items.push(`必須の経験：${signals.requiredExperience.excerpt}（登録済みの経験・作品で満たすか確認）`);
  }
  if (signals && signals.qualification && signals.qualification.level === 'confirm') {
    items.push(`応募資格：${signals.qualification.excerpt}（ゆうきの経歴で満たすか確認）`);
  }
  if (job.priceUnverified) items.push('報酬額が未確認（案件詳細で確認）');
  if (analysis && analysis.recommendation && analysis.recommendation.value === 'hold') {
    items.push('Knowledgeだけでは対応可否を判断できない（人による確認が必要）');
  }
  return items;
}

// 1案件を4分類に振り分ける（副作用なし）。analysisが無い案件は全文未確認として扱う。
function classifyFinal(job, analysis) {
  const rec = analysis && analysis.recommendation;
  const signals = analysis && analysis.selectionSignals ? analysis.selectionSignals : null;

  if (rec && rec.value === 'stop') {
    const reason = (rec.reasons || []).join('、') || '理由の記載なし';
    return { cls: '対象外', reason: `Stage1判定: 見送り（${reason}）`, confirmItems: [], shortage: [], actions: [] };
  }

  if (signals && signals.qualification && signals.qualification.level === 'mismatch') {
    return { cls: '対象外', reason: `明確な応募資格の不一致：${signals.qualification.excerpt}`, confirmItems: [], shortage: [], actions: [] };
  }

  if (!analysis) {
    const origin = job.displayTier;
    if (origin === 'high_value_challenge' || origin === 'normal_challenge') {
      return { cls: '育成候補', reason: '詳細未取得（全文未確認）', confirmItems: [], shortage: [], actions: [GROWTH_DEFAULT_ACTION], unverified: true };
    }
    return { cls: '要確認', reason: '詳細未取得のため全文未確認', confirmItems: ['案件全文が未確認（詳細取得の上限）'], shortage: [], actions: [], unverified: true };
  }

  const refl = analysis.searchSystemReevaluation || {};
  const categoryId = signals ? signals.categoryId : null;
  const confirmItems = importantConfirmItems(job, analysis, signals);

  const submissionShortage = signals && signals.requiredSubmission ? signals.requiredSubmission.uncovered || [] : [];
  const shortage = submissionShortage.map(u => `必須の提出物「${u.label}」の同種の作品がない`);
  const actions = submissionShortage.map(u => u.action).filter(Boolean);

  if (confirmItems.length > 0) {
    return { cls: '要確認', reason: '重要事項が未確認', confirmItems, shortage, actions, categoryId };
  }
  if (submissionShortage.length > 0) {
    return { cls: '育成候補', reason: '必須の提出物が不足', confirmItems: [], shortage, actions, categoryId };
  }

  const status = refl.capabilityStatus;
  const evidence = refl.evidenceType;

  if (status === '確認候補') {
    return { cls: '要確認', reason: 'Knowledgeだけでは対応可否を判断できない', confirmItems: ['Knowledgeだけでは対応可否を判断できない（人による確認が必要）'], shortage: [], actions: [], categoryId };
  }
  if (status === '応募可能' && STRONG_EVIDENCE.includes(evidence)) {
    return { cls: '今応募', slot: 'main', reason: '戦略適合・条件を満たす', confirmItems: [], shortage: [], actions: [], categoryId };
  }
  if (status === 'チャレンジ可能' && REVENUE_CATEGORY_IDS.includes(categoryId) && STRONG_EVIDENCE.includes(evidence)) {
    const g = GROWTH_BY_CATEGORY[categoryId];
    return {
      cls: '今応募', slot: 'revenue', reason: '収益・実績確保領域（条件を満たすライティング）',
      confirmItems: [], shortage: g ? [g.shortage] : [], actions: g ? [g.action] : [], categoryId,
    };
  }

  // 育成候補：不足は案件が求める提出物を優先し、無ければカテゴリー別／Knowledgeの不足実績を使う
  const g = GROWTH_BY_CATEGORY[categoryId];
  const knowledgeShortage = (refl.missingEvidence || []).filter(Boolean);
  return {
    cls: '育成候補', reason: status === 'チャレンジ可能' ? 'チャレンジ領域（実績・作品が不足）' : '証拠が弱い',
    confirmItems: [],
    shortage: g ? [g.shortage] : (knowledgeShortage.length > 0 ? knowledgeShortage : ['この案件に近い外部受注実績・作品が不足']),
    actions: g ? [g.action] : [GROWTH_DEFAULT_ACTION],
    categoryId,
  };
}

function classifyAll(state, loadAnalysis = loadJobAnalysis) {
  const origin = [
    ...state.nowApply.map(job => ({ job, from: 'now' })),
    ...state.highValueChallenge.map(job => ({ job, from: 'high' })),
    ...state.normalChallenge.map(job => ({ job, from: 'normal' })),
    ...state.confirmCandidates.map(job => ({ job, from: 'confirm' })),
  ];
  return origin.map(({ job, from }) => ({ job, from, result: classifyFinal(job, loadAnalysis(job.id)) }));
}

// ===== 3. 振り直し（破壊的に更新する）=====
function applyDisplayFields(job, result) {
  job.finalClass = result.cls;
  job.finalReason = result.reason;
  job.slot = result.slot || null;
  job.unverified = !!result.unverified;
  if (result.confirmItems.length > 0) {
    job.confirmBeforeApply = [...(job.confirmBeforeApply || []), ...result.confirmItems.filter(c => !(job.confirmBeforeApply || []).includes(c))];
  }
  if (result.cls === '育成候補' || result.slot === 'revenue') {
    if (result.shortage.length > 0) job.missingAssets = result.shortage;
    job.growthActions = result.actions;
  }
}

function rebucket(state, { minMain = MIN_MAIN, maxNow = MAIN_TARGET, loadAnalysis = loadJobAnalysis } = {}) {
  const classified = classifyAll(state, loadAnalysis);
  const main = [], revenue = [], confirm = [], grow = [], out = [];

  for (const { job, from, result } of classified) {
    const j = { ...job };
    j.__from = from;
    if (result.cls === '対象外') { out.push({ job: j, result }); continue; }
    if (result.cls === '今応募') { (result.slot === 'revenue' ? revenue : main).push({ job: j, result }); continue; }
    if (result.cls === '要確認') { confirm.push({ job: j, result }); continue; }
    grow.push({ job: j, result });
  }

  // 主力が足りない日だけ、収益・実績候補で補充する（残りは育成枠に戻す）
  const sortedRevenue = revenue.sort((a, b) => byRankThenScore(a.job, b.job));
  const needed = Math.max(0, minMain - main.length);
  const promoted = sortedRevenue.slice(0, needed);
  for (const r of sortedRevenue.slice(needed)) {
    r.result = { ...r.result, cls: '育成候補', slot: null, reason: '収益・実績候補（主力の今応募が足りているため育成枠）' };
    grow.push(r);
  }

  const sortFn = (a, b) => byRankThenScore(a.job, b.job);
  main.sort(sortFn);
  const nowList = [...main, ...promoted].slice(0, maxNow);

  // 配列を更新
  state.nowApply.length = 0;
  state.highValueChallenge.length = 0;
  state.normalChallenge.length = 0;
  state.confirmCandidates.length = 0;

  for (const r of nowList) { applyDisplayFields(r.job, r.result); delete r.job.__from; state.nowApply.push(r.job); }
  // 全文確認済みの要確認を先に、詳細未取得（全文未確認）のものは後ろに並べる
  const confirmAll = [...confirm].sort((a, b) => (a.result.unverified ? 1 : 0) - (b.result.unverified ? 1 : 0) || sortFn(a, b));
  for (const r of confirmAll.slice(0, MAX_GROWTH)) { applyDisplayFields(r.job, r.result); delete r.job.__from; state.confirmCandidates.push(r.job); }
  for (const r of grow.sort(sortFn).slice(0, MAX_GROWTH * 2)) {
    applyDisplayFields(r.job, r.result);
    const highValue = r.job.displayTier === 'high_value_challenge';
    delete r.job.__from;
    (highValue ? state.highValueChallenge : state.normalChallenge).push(r.job);
  }

  const stopped = [];
  for (const { job, result } of out) {
    delete job.__from;
    const demoted = { ...job, excluded: true, excludeReason: '対応不可（Knowledge判定）', skipReason: result.reason, finalClass: '対象外' };
    state.excluded.push(demoted);
    stopped.push(demoted);
  }

  return {
    counts: {
      今応募: state.nowApply.length,
      主力: state.nowApply.filter(j => j.slot !== 'revenue').length,
      収益実績枠: state.nowApply.filter(j => j.slot === 'revenue').length,
      要確認: state.confirmCandidates.length,
      育成候補: state.highValueChallenge.length + state.normalChallenge.length,
      対象外: stopped.length,
    },
    stopped,
  };
}

// 旧API互換（Stage1が見送り判定した案件を今すぐ応募から外し、除外へ移す）。
function demoteStopped(nowApply, excluded, loadAnalysis = loadJobAnalysis) {
  const stopped = [];
  for (let i = nowApply.length - 1; i >= 0; i--) {
    const job = nowApply[i];
    const analysis = loadAnalysis(job.id);
    const rec = analysis && analysis.recommendation;
    if (!rec || rec.value !== 'stop') continue;
    nowApply.splice(i, 1);
    const reason = (rec.reasons || []).join('、') || '理由の記載なし';
    const demoted = { ...job, excluded: true, excludeReason: '対応不可（Knowledge判定）', skipReason: `Stage1判定: 見送り（${reason}）`, finalClass: '対象外' };
    excluded.push(demoted);
    stopped.unshift(demoted);
  }
  return stopped;
}

// ===== 4. 補充用の詳細取得プール =====
// 全文判定が未実施（分析ファイルが無い）、かつ今回すでに試行していない候補を優先順に返す。
function selectBackfillPool(state, attemptedIds, limit, loadAnalysis = loadJobAnalysis) {
  const attempted = new Set(attemptedIds);
  const pool = [];
  const seen = new Set();
  const buckets = [
    ['now', state.nowApply], ['high_value_challenge', state.highValueChallenge],
    ['normal_challenge', state.normalChallenge], ['confirm_candidate', state.confirmCandidates],
  ];
  for (const [label, bucket] of buckets) {
    for (const job of bucket) {
      if (pool.length >= limit) return pool;
      if (attempted.has(job.id) || seen.has(job.id) || loadAnalysis(job.id)) continue;
      seen.add(job.id);
      pool.push({ ...job, detailFetchBucket: label });
    }
  }
  return pool;
}

// 現在の「今応募（主力）」の件数（補充の要否判定用。状態は変更しない）
function countMainNow(state, loadAnalysis = loadJobAnalysis) {
  return classifyAll(state, loadAnalysis).filter(c => c.result.cls === '今応募' && c.result.slot === 'main').length;
}

module.exports = {
  buildUncappedState,
  MIN_MAIN,
  MAIN_TARGET,
  SERIAL_REASON,
  isSerialPair,
  collapseSerialPostings,
  classifyFinal,
  rebucket,
  demoteStopped,
  selectBackfillPool,
  countMainNow,
};
