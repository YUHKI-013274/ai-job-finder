const {
  EXCLUDE_PATTERNS,
  CATEGORY_TIERS,
  PORTFOLIO_FIT_TIERS,
  BEGINNER_PATTERNS,
  EXPERIENCE_PREFERRED_PATTERNS,
  SUPPORT_PATTERNS,
  AI_USAGE_ALLOWED_PATTERNS,
  AMBIGUOUS_PRICE_PATTERNS,
  CONTINUITY_PATTERNS,
  CLIENT_TRUST_PATTERNS,
  RISK_PATTERNS,
  MIN_PRICE_YEN,
  MIN_CANDIDATES,
  AI_FRIENDLY_KEYWORDS,
  AI_TECHNICAL_KEYWORDS,
  STRENGTH_HINTS,
  WEIGHTS,
  MAX_JOBS,
  MAX_HOLDS,
  PROPOSAL_SIGNAL_PATTERNS,
  HOSPITALITY_BRAND_PATTERNS,
  OPERATIONAL_SIGNAL_PATTERNS,
  SIMPLE_WORK_PATTERNS,
  APPLICANT_ATTRIBUTE_EXCLUDE_PATTERNS,
  APPLICANT_ATTRIBUTE_CAUTION_PATTERNS,
  CLIENT_RISK_MINUS_PATTERNS,
  CLIENT_RISK_PLUS_PATTERNS,
} = require('./config');

// 営業資料（ポートフォリオページ）が存在する3カテゴリ
const PORTFOLIO_BACKED_TIERS = ['writing', 'design', 'ai_business'];

function toStars(score, max = 5) {
  const filled = Math.round(Math.min(max, Math.max(0, score)));
  return '★'.repeat(filled) + '☆'.repeat(max - filled);
}

// パターンは文字列（部分一致）と正規表現（表記ゆれ対応）を混在できる
function matchPatterns(text, patterns) {
  const lower = text.toLowerCase();
  return patterns.filter(p => {
    if (p instanceof RegExp) return p.test(text);
    return lower.includes(String(p).toLowerCase());
  });
}

function containsAny(text, patterns) {
  return matchPatterns(text, patterns).length > 0;
}

// 全角数字・全角カンマを半角へ正規化する（⑤ 全角数字の金額解析対応）。
// クラウドワークスのタイトル等で「１件３円」のように全角数字が使われるケースがあり、
// 正規化せずに解析すると金額・件数が読み取れず、低単価案件を見逃す原因になる。
function normalizeFullWidthDigits(str) {
  if (!str) return str;
  return String(str)
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/，/g, ',');
}

// 案件の報酬表記（例: "¥3,000〜5,000" "5万円" "3,000円〜5,000円"）から
// 最低金額（円）を推定する。読み取れない場合は null を返す。
function parsePriceToYen(priceStr) {
  if (!priceStr || /要確認/.test(priceStr)) return null;
  priceStr = normalizeFullWidthDigits(priceStr);
  const values = [];

  // ¥3,000〜5,000 のような¥記号付き表記
  const yenSymbolRe = /[¥￥]\s*([\d,]+)/g;
  let match;
  while ((match = yenSymbolRe.exec(priceStr)) !== null) {
    const num = parseInt(match[1].replace(/,/g, ''), 10);
    if (!Number.isNaN(num)) values.push(num);
  }

  // 3,000円・5万円 のような「円」を伴う表記のみを金額として扱う
  // （「1本1500円」「1記事2700円」の先頭の"1"のような個数表記を誤って金額と解釈しないため、
  //  「円」の直前の数字のみにマッチさせる）
  const enSuffixRe = /([\d,]+)\s*(万)?\s*円/g;
  while ((match = enSuffixRe.exec(priceStr)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    if (!numStr) continue;
    let num = parseInt(numStr, 10);
    if (Number.isNaN(num)) continue;
    if (match[2] === '万') num *= 10000;
    values.push(num);
  }

  return values.length > 0 ? Math.min(...values) : null;
}

// タイトル等に埋め込まれた「1件3円」のような件数単価表記を検出する（⑤）。
// job.priceフィールドが「要確認」でも、タイトル側に極端な低単価が明記されているケースを拾うため、
// price文字列だけでなくtext全体（正規化済み）に対して実行する。
function detectExtremeLowUnitPrice(text) {
  const m = text.match(/(\d+)\s*(?:件|本|枚|文字)\s*(?:につき)?\s*(\d+)\s*円/);
  if (!m) return null;
  const yen = parseInt(m[2], 10);
  return Number.isNaN(yen) ? null : yen;
}

// 報酬が「要確認」「成果報酬のみ」等ではないが、応相談などで金額を確定できない表記かどうか
function isPriceAmbiguous(priceStr) {
  if (!priceStr) return true;
  return containsAny(priceStr, AMBIGUOUS_PRICE_PATTERNS);
}

// ジャンル判定の最低スコア。タイトル一致1件（weight 3）か、本文一致2件以上（weight 2）が
// なければ「その他」とし、本文に単語が1回含まれるだけで代表ジャンルにしない。
const MIN_CATEGORY_WEIGHT = 2;

// ②ライティング・画像・AI活用との一致度：ジャンルを判定する。
// タイトルでの一致を本文より重く扱い（案件の中心業務はタイトルに表れることが多い）、
// 単語が1回本文に含まれるだけで別ジャンルに誤判定されないよう、各ジャンルの一致数で
// 重み付けした合計スコアが最も高いジャンルを採用する（同点時は優先順位の高いジャンルを採用）。
function detectCategoryTier(job) {
  const title = job.title || '';
  const desc = job.description || '';

  const scored = CATEGORY_TIERS.map(tier => {
    const titleMatches = matchPatterns(title, tier.patterns);
    const descMatches = matchPatterns(desc, tier.patterns);
    const weighted = titleMatches.length * 3 + descMatches.length;
    const representative = titleMatches[0] || descMatches[0] || null;
    return { tier, weighted, representative };
  });

  scored.sort((a, b) => b.weighted - a.weighted);
  const top = scored[0];
  if (!top || top.weighted < MIN_CATEGORY_WEIGHT) {
    return { tier: 'other', label: 'その他', score: 2, patterns: [], representative: null };
  }
  return { ...top.tier, representative: top.representative };
}

// ①ポートフォリオ活用度（最優先）：ライティング／画像制作／AI活用・業務改善の
// いずれかの営業資料ページを、この案件への応募でそのまま使えるかを3段階で判定する。
// 3カテゴリに該当しない案件（通常案件・動画/撮影/音声系・その他）は営業資料が無いため低スコア固定。
function computePortfolioActivationScore(categoryInfo, text) {
  const fitTiers = PORTFOLIO_FIT_TIERS[categoryInfo.tier];
  if (!fitTiers) return 1;
  // 低一致（専門知識が必要な分野等）を最優先でチェックする。
  // 「体験談」等の一般的な語と専門分野の語（医療・美容等）が同じ文章に混在する場合、
  // 配列の並び順だけで判定すると中一致に誤判定されるため、低一致を先に確定させる。
  const low = fitTiers.find(f => f.level === 'low');
  const high = fitTiers.find(f => f.level === 'high');
  const mid = fitTiers.find(f => f.level === 'mid');
  if (low && containsAny(text, low.patterns)) return low.score;
  if (high && containsAny(text, high.patterns)) return high.score;
  if (mid && containsAny(text, mid.patterns)) return mid.score;
  return 3; // 3カテゴリには該当するが具体的な一致内容までは分類できない場合は中間点
}

// ③ゆうきとの適性：AI活用・ライティング関連の強みキーワードの一致量
function computeAptitudeScore(aiFriendlyMatches, categoryInfo) {
  let score = 1 + Math.min(3, aiFriendlyMatches.length);
  if (PORTFOLIO_BACKED_TIERS.includes(categoryInfo.tier)) score += 1;
  return Math.min(5, score);
}

// ①Instagram・SNSデザイン案件を「提案型」か「作業型」かで評価する（ジャンル名だけで一律判定しない）。
// design案件、またはジャンルが定まらない案件（other/normal）でInstagram/SNSに言及がある場合だけを対象とする。
// writing/ai_business/low等、既に別の基準で評価済みのジャンルには適用しない
// （例：「SNSライティング」のような複合語で意図せずライティング案件が加点されるのを防ぐ）。
function computeSnsProposalAdjustment(categoryInfo, text) {
  const eligibleTier = categoryInfo.tier === 'design' || categoryInfo.tier === 'normal' || categoryInfo.tier === 'other';
  const isSnsDesignJob = eligibleTier && (categoryInfo.tier === 'design' || /Instagram|インスタ|SNS/i.test(text));
  if (!isSnsDesignJob) {
    return { delta: 0, proposalMatches: [], operationalMatches: [], hospitalityMatches: [] };
  }

  const proposalMatches = matchPatterns(text, PROPOSAL_SIGNAL_PATTERNS);
  const operationalMatches = matchPatterns(text, OPERATIONAL_SIGNAL_PATTERNS);
  const hospitalityMatches = matchPatterns(text, HOSPITALITY_BRAND_PATTERNS);

  let delta = 0;
  if (proposalMatches.length > 0) delta += Math.min(2, proposalMatches.length);
  if (proposalMatches.length > 0 && hospitalityMatches.length > 0) delta += 1;
  if (operationalMatches.length > 0) delta -= Math.min(2, operationalMatches.length);

  return { delta, proposalMatches, operationalMatches, hospitalityMatches };
}

// ②クライアントの複合リスク評価：単独項目（本人確認未提出など）では判定せず、
// マイナス要素とプラス要素を合算したスコアとして受注可能性に反映する。
function computeClientRiskDelta(text) {
  const minusMatches = matchPatterns(text, CLIENT_RISK_MINUS_PATTERNS);
  const plusMatches = matchPatterns(text, CLIENT_RISK_PLUS_PATTERNS);
  const rawDelta = plusMatches.length - minusMatches.length;
  return { delta: Math.max(-2, Math.min(2, rawDelta)), minusMatches, plusMatches };
}

// ⑥経験者優遇は単独で減点確定せず、未経験可否・ポートフォリオ必須の有無・案件適合度と組み合わせて評価する。
function computeExperienceAdjustment(text, experiencePreferredMatches, beginnerMatches, categoryInfo, aptitudeScore) {
  if (experiencePreferredMatches.length === 0) return 0;
  let adjustment = -1;
  if (beginnerMatches.length > 0) adjustment += 1; // 未経験OKも併記されている場合はハードルが実質低いとみなす
  if (/ポートフォリオ必須|実績提出必須|ポートフォリオ提出必須/.test(text)) adjustment -= 1; // 提出必須は実質的な参入障壁
  if (PORTFOLIO_BACKED_TIERS.includes(categoryInfo.tier) && aptitudeScore >= 4) adjustment += 1; // 案件との適合度が高ければ相殺
  return Math.max(-2, Math.min(1, adjustment));
}

// ④受注できる可能性：サポート体制・信頼性・応募者数・経験条件・クライアントリスクから判定
// （未経験歓迎そのものは含めない＝⑦で別途評価。経験者歓迎は⑥の複合評価を使う）
function computeWinScore(text, supportMatches, trustMatches, experienceAdjustment, clientRiskDelta) {
  let score = 3;
  if (supportMatches.length > 0) score += 1;
  if (trustMatches.length > 0) score += 1;
  if (/小規模|少量|お試し|トライアル/.test(text)) score += 1;
  if (/実績\s*\d+\s*件以上/.test(text)) score -= 1;
  score += experienceAdjustment;
  const appMatch = text.match(/(\d+)\s*人が応募/);
  if (appMatch && parseInt(appMatch[1], 10) > 20) score -= 1;
  score += clientRiskDelta;
  return Math.min(5, Math.max(1, score));
}

// ⑥単価：金額が高いほど加点（不明な場合は中間点。ただしTOP5候補には入れない＝classifyJobsで制御）
function computePriceScore(priceYen) {
  if (priceYen === null) return 3;
  if (priceYen >= 10000) return 5;
  if (priceYen >= 5000) return 4;
  if (priceYen >= 3000) return 3;
  if (priceYen >= 1000) return 2;
  return 1;
}

// Sランクは「3つの営業資料カテゴリ（ライティング/画像制作/AI活用・業務改善）のいずれかで
// ポートフォリオ活用度が高く、かつ受注しやすく実績になる」場合のみに限定する
function meetsSRankConditions({ categoryInfo, portfolioActivationScore, beginnerMatches, continuityMatches, winScore, priceYen, text }) {
  if (!PORTFOLIO_BACKED_TIERS.includes(categoryInfo.tier)) return false;
  if (portfolioActivationScore < 4) return false;
  if (priceYen === null || priceYen < 1000) return false;
  if (beginnerMatches.length === 0) return false;
  const isOneOff = /単発|1回限り|一度のみ|一度きり/.test(text);
  if (continuityMatches.length === 0 && isOneOff) return false;
  if (winScore < 4) return false;
  return true;
}

// ①ポートフォリオ活用度の重みが最も重くなったため、スコア上限が広がった分に合わせて閾値を調整
function totalScoreToRank(totalScore) {
  if (totalScore >= 72) return 'S';
  if (totalScore >= 55) return 'A';
  if (totalScore >= 37) return 'B';
  return 'C';
}

function evaluateJob(job) {
  // ⑤全角数字（１件３円 等）も正しく解析できるよう、判定に使う本文は先に正規化しておく
  const text = normalizeFullWidthDigits(`${job.title} ${job.description || ''}`);

  if (containsAny(text, RISK_PATTERNS)) {
    return { ...job, excluded: true, excludeReason: 'リスクあり' };
  }

  // job.price（要確認等）だけでなく、タイトル等に埋め込まれた「1件3円」のような
  // 件数単価表記も極端な低単価として検出する
  const parsedPriceYen = parsePriceToYen(job.price);
  const unitPriceYen = detectExtremeLowUnitPrice(text);
  const priceYen = parsedPriceYen !== null ? parsedPriceYen : unitPriceYen;
  if (priceYen !== null && priceYen < MIN_PRICE_YEN) {
    return { ...job, excluded: true, excludeReason: '単価が低すぎる', priceYen };
  }

  if (containsAny(text, EXCLUDE_PATTERNS)) {
    return { ...job, excluded: true, excludeReason: '条件不一致', priceYen };
  }

  // ④応募者自身の性別・年代等を暗黙に求める表現（ナレーター・モデル等、役割自体が属性を要求するもの）。
  // 「女性向け商品の画像制作」等、読者・商品ターゲットを表すだけの表現はここに含めない。
  if (containsAny(text, APPLICANT_ATTRIBUTE_EXCLUDE_PATTERNS)) {
    return { ...job, excluded: true, excludeReason: '条件不一致（属性）', priceYen };
  }

  // 報酬が「要確認」／パース不能／応相談等で金額を確認できない場合は、
  // 応募候補（TOP5）には入れず保留に回す（classifyJobsで制御するためのフラグ）
  const priceUnverified = parsedPriceYen === null || isPriceAmbiguous(job.price);

  // ②ライティング・画像・AI活用との一致度。タイトル/本文の一致数で中心業務を判定する
  const categoryInfo = detectCategoryTier(job);

  // ③データ入力・リスト作成等の単純作業は、営業資料ページを持つ3ジャンル（writing/design/ai_business）
  // に該当しない限り、ジャンルスコアを下げて低優先として扱う
  const simpleWorkMatches = matchPatterns(text, SIMPLE_WORK_PATTERNS);
  if (simpleWorkMatches.length > 0 && !PORTFOLIO_BACKED_TIERS.includes(categoryInfo.tier)) {
    categoryInfo.score = Math.max(1, categoryInfo.score - 2);
  }

  // ①ポートフォリオ活用度（最優先）：3つの営業資料ページとの一致度合い
  // Instagram・SNSデザイン案件は、ジャンル名だけで一律判定せず、
  // 提案・企画型のシグナルがあれば加点、テンプレ流し込み等の作業型シグナルがあれば減点する
  const snsAdjustment = computeSnsProposalAdjustment(categoryInfo, text);
  let portfolioActivationScore = computePortfolioActivationScore(categoryInfo, text);
  if (snsAdjustment.delta !== 0) {
    portfolioActivationScore = Math.max(1, Math.min(5, portfolioActivationScore + snsAdjustment.delta));
  }

  // ③ゆうきとの適性
  const aiFriendlyMatches = matchPatterns(text, AI_FRIENDLY_KEYWORDS);
  const technicalMatches = matchPatterns(text, AI_TECHNICAL_KEYWORDS);
  const aptitudeScore = computeAptitudeScore(aiFriendlyMatches, categoryInfo);

  // ⑦未経験歓迎（最も軽い重み。単独では高評価にしない）。⑥の経験者優遇の複合評価でも使うため先に計算する
  const beginnerMatches = matchPatterns(text, BEGINNER_PATTERNS);
  const beginnerScore = beginnerMatches.length > 0 ? 5 : 2;

  // ④受注できる可能性（経験者歓迎は⑥の複合評価、クライアントリスクは②の複合評価を使う）
  const supportMatches = matchPatterns(text, SUPPORT_PATTERNS);
  const trustMatches = matchPatterns(text, CLIENT_TRUST_PATTERNS);
  const experiencePreferredMatches = matchPatterns(text, EXPERIENCE_PREFERRED_PATTERNS);
  const experienceAdjustment = computeExperienceAdjustment(text, experiencePreferredMatches, beginnerMatches, categoryInfo, aptitudeScore);
  const clientRisk = computeClientRiskDelta(text);
  const winScore = computeWinScore(text, supportMatches, trustMatches, experienceAdjustment, clientRisk.delta);

  // ⑤継続性
  const continuityMatches = matchPatterns(text, CONTINUITY_PATTERNS);
  const continuityScore = continuityMatches.length > 0 ? 5 : 2;

  // ⑥単価
  const priceScore = computePriceScore(priceYen);

  // 総合スコア（①〜⑦の優先順位をそのまま重みに反映）
  const totalScore =
    portfolioActivationScore * WEIGHTS.portfolioActivation +
    categoryInfo.score * WEIGHTS.category +
    aptitudeScore * WEIGHTS.aptitude +
    winScore * WEIGHTS.win +
    continuityScore * WEIGHTS.continuity +
    priceScore * WEIGHTS.price +
    beginnerScore * WEIGHTS.beginner;

  let rank = totalScoreToRank(totalScore);

  // Sランクは3つの営業資料カテゴリで高いポートフォリオ活用度があり、受注しやすく実績になる場合のみ
  if (rank === 'S' && !meetsSRankConditions({ categoryInfo, portfolioActivationScore, beginnerMatches, continuityMatches, winScore, priceYen, text })) {
    rank = 'A';
  }
  // 動画編集・撮影・音声系は未経験歓迎でも高評価にしない（S/Aには乗せない）
  if (categoryInfo.tier === 'low' && (rank === 'S' || rank === 'A')) {
    rank = 'B';
  }
  // ③データ入力・リスト作成等の単純作業中心の案件も、営業資料ページを持つ3ジャンルに該当しない限りS/Aには乗せない
  if (simpleWorkMatches.length > 0 && !PORTFOLIO_BACKED_TIERS.includes(categoryInfo.tier) && (rank === 'S' || rank === 'A')) {
    rank = 'B';
  }

  const genre = categoryInfo.label;

  // 高評価の理由（★の数で重要度が分かる形式で可視化）
  const matchedSignals = buildWeightedSignals({
    categoryInfo, portfolioActivationScore, aptitudeScore, beginnerMatches, continuityMatches,
    winScore, trustMatches, aiFriendlyMatches, snsAdjustment,
  });
  const reason = matchedSignals.length > 0
    ? matchedSignals.map(s => `${toStars(s.stars)} ${s.label}`).join('\n')
    : '安全に完了できそうな案件（実績作りとして検討可）';

  // 注意点
  const caution = buildCaution(text, technicalMatches, aiFriendlyMatches, categoryInfo, priceUnverified, experiencePreferredMatches, {
    snsAdjustment, simpleWorkMatches, clientRisk,
  });

  // 提案文の強み（案件内容に応じて使い分ける）
  const strengthHint = buildStrengthHint(text, categoryInfo);

  return {
    ...job,
    // 検索キーワード（scraper.jsが検索に使った語）ではなく、実際の中心業務と一致するキーワードを表示する
    matchedKeyword: categoryInfo.representative || job.matchedKeyword,
    genre,
    categoryTier: categoryInfo.tier,
    categoryScore: categoryInfo.score,
    portfolioActivationScore,
    aptitudeScore,
    winScore,
    continuityScore,
    priceScore,
    beginnerScore,
    totalScore,
    rank,
    priceUnverified,
    matchedSignals,
    reason,
    caution,
    strengthHint,
    priceYen,
    excluded: false,
    excludeReason: null,
    snsAdjustmentDelta: snsAdjustment.delta,
    clientRiskDelta: clientRisk.delta,
    simpleWork: simpleWorkMatches.length > 0,
  };
}

// 案件が該当する営業資料ページの案内文（①ポートフォリオ活用度の表示用）
function portfolioPageLabel(tier) {
  if (tier === 'writing') return 'ライティングページを営業資料にできる';
  if (tier === 'design') return '画像制作ページを営業資料にできる';
  if (tier === 'ai_business') return 'AI活用・業務改善ページを営業資料にできる';
  return null;
}

// マッチした信号を★の数（重要度）付きでまとめる（表示用チェックリスト）
function buildWeightedSignals({ categoryInfo, portfolioActivationScore, aptitudeScore, beginnerMatches, continuityMatches, winScore, trustMatches, aiFriendlyMatches, snsAdjustment }) {
  const signals = [];
  signals.push({ label: categoryInfo.label, stars: categoryInfo.score });

  const pageLabel = portfolioPageLabel(categoryInfo.tier);
  if (pageLabel) {
    signals.push({ label: pageLabel, stars: portfolioActivationScore });
  }
  if (snsAdjustment && snsAdjustment.proposalMatches.length > 0) {
    signals.push({ label: `提案・企画の余地がある（${snsAdjustment.proposalMatches[0]}）`, stars: portfolioActivationScore });
  }
  if (aiFriendlyMatches.length > 0) {
    signals.push({ label: 'AI活用経験をアピールできる', stars: aptitudeScore });
  }
  if (continuityMatches.length > 0) {
    signals.push({ label: '継続案件の可能性', stars: 4 });
  }
  if (winScore >= 4) {
    signals.push({ label: '受注できる可能性が高い', stars: winScore });
  }
  if (trustMatches.length > 0) {
    signals.push({ label: 'クライアントの信頼性が高い', stars: 3 });
  }
  if (beginnerMatches.length > 0) {
    signals.push({ label: '未経験・初心者歓迎', stars: 3 });
  }

  return signals.sort((a, b) => b.stars - a.stars);
}

function buildCaution(text, technicalMatches, aiFriendlyMatches, categoryInfo, priceUnverified, experiencePreferredMatches, extra = {}) {
  const { snsAdjustment, simpleWorkMatches, clientRisk } = extra;
  const cautions = [];
  if (priceUnverified) {
    cautions.push('報酬額が確認できないため応募候補（TOP5）には入れていません。案件詳細で金額を確認してから判断してください');
  }
  if (experiencePreferredMatches.length > 0) {
    cautions.push('「経験者歓迎」の記載があります。未経験可否や案件との適合度と合わせて判断してください');
  }
  if (categoryInfo.tier === 'low') {
    cautions.push('優先度の低いジャンル（動画編集・撮影・音声系）の案件です。他に良い案件がない場合のみ検討してください');
  }
  if (simpleWorkMatches && simpleWorkMatches.length > 0) {
    cautions.push('単純作業（データ入力・リスト作成・情報転記等）の比重が高い案件です');
  }
  if (snsAdjustment && snsAdjustment.operationalMatches.length > 0 && snsAdjustment.proposalMatches.length === 0) {
    cautions.push(`テンプレート・素材支給への流し込み中心の作業型案件の可能性があります（${snsAdjustment.operationalMatches[0]}）`);
  }
  if (!PORTFOLIO_BACKED_TIERS.includes(categoryInfo.tier) && categoryInfo.tier !== 'low') {
    cautions.push('ライティング・画像制作・AI活用の営業資料ページと直接一致しない案件です');
  }
  if (technicalMatches.length > 0 && aiFriendlyMatches.length === 0) {
    cautions.push('本格的なエンジニアリング経験を求められる可能性があります（優先度低）');
  }
  if (containsAny(text, APPLICANT_ATTRIBUTE_CAUTION_PATTERNS)) {
    cautions.push('「女性向け」等の表現があります。読者・商品ターゲットの説明か、応募者自身の属性条件かを案件詳細で確認してください');
  }
  if (clientRisk && clientRisk.minusMatches.length > 0) {
    cautions.push(`クライアントのリスク要因（${clientRisk.minusMatches[0]}）が見られます。他の条件と合わせて総合的に判断してください`);
  }
  if (/実績\s*\d+\s*件以上/.test(text)) cautions.push('実績件数の要件（必須ではなく尚可の可能性）を確認して応募を判断');
  if (/週\s*\d+\s*時間/.test(text)) cautions.push('稼働時間の条件を確認');
  if (/単価|予算/.test(text)) cautions.push('予算が明記されていない場合は要確認');
  const appMatch = text.match(/(\d+)\s*人が応募/);
  if (appMatch && parseInt(appMatch[1]) > 20) cautions.push(`応募者が${appMatch[1]}人と多い・差別化が重要`);
  if (cautions.length === 0) cautions.push('案件詳細で業務範囲と納期を必ず確認');
  return cautions.join('、');
}

// 提案文の軸を案件内容に合わせて選ぶ（飲食業界の実務経験は関連案件のみに使用し、
// AI活用の訴求はAI利用が許可・歓迎されている案件のみに含める）
function buildStrengthHint(text, categoryInfo) {
  const hospitalityRelevant = /飲食|接客|店舗運営|店舗管理|店舗マネジメント|人材育成|採用面接|業務改善|マネジメント|マネージャー|店長/.test(text);
  const aiUsageAllowed = containsAny(text, AI_USAGE_ALLOWED_PATTERNS);

  if (categoryInfo.tier === 'writing') {
    let hint;
    if (hospitalityRelevant) {
      hint = STRENGTH_HINTS.hospitalityWriting;
    } else if (/SEO記事|比較記事|商品レビュー|レビュー記事/.test(text)) {
      hint = STRENGTH_HINTS.seoCompare;
    } else if (/リサーチ|調査/.test(text)) {
      hint = STRENGTH_HINTS.research;
    } else {
      hint = STRENGTH_HINTS.readerFocus;
    }
    if (aiUsageAllowed) hint = `${hint}${STRENGTH_HINTS.aiAddendum}`;
    return hint;
  }

  if (categoryInfo.tier === 'ai_business') {
    if (hospitalityRelevant) return STRENGTH_HINTS.ai;
    if (/Notion/.test(text)) return STRENGTH_HINTS.notion;
    return STRENGTH_HINTS.operations;
  }

  if (hospitalityRelevant) return STRENGTH_HINTS.management;
  if (/マニュアル|業務改善|仕組み|自動化/.test(text)) return STRENGTH_HINTS.operations;
  if (/Notion/.test(text)) return STRENGTH_HINTS.notion;
  if (aiUsageAllowed) return STRENGTH_HINTS.ai;
  if (/未経験|初心者/.test(text)) return STRENGTH_HINTS.beginner;
  return STRENGTH_HINTS.communication;
}

const RANK_ORDER = { S: 0, A: 1, B: 2, C: 3 };

function byRankThenScore(a, b) {
  const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  if (rankDiff !== 0) return rankDiff;
  return b.totalScore - a.totalScore;
}

// 案件一覧を「応募候補」「保留」「除外」の3分類に振り分ける。
// appliedMap / seenMap / rejectedMap は { [jobId]: {...} } の形（値の有無だけを見る）。
function classifyJobs(jobs, appliedMap = {}, seenMap = {}, rejectedMap = {}) {
  const candidates = [];
  const holds = [];
  const excluded = [];

  for (const raw of jobs) {
    if (appliedMap[raw.id]) {
      excluded.push({ ...raw, excluded: true, excludeReason: '応募済み' });
      continue;
    }
    if (rejectedMap[raw.id]) {
      excluded.push({
        ...raw,
        excluded: true,
        excludeReason: '見送り',
        skipReason: rejectedMap[raw.id].reason || '理由未記入',
      });
      continue;
    }
    if (seenMap[raw.id]) {
      excluded.push({ ...raw, excluded: true, excludeReason: '既出' });
      continue;
    }

    const job = evaluateJob(raw);
    if (job.excluded) {
      excluded.push(job);
      continue;
    }

    // 金額が確認できない案件は、ランクにかかわらず応募候補には入れず保留に回す
    if (!job.priceUnverified && (job.rank === 'S' || job.rank === 'A')) {
      candidates.push(job);
    } else {
      holds.push(job);
    }
  }

  candidates.sort(byRankThenScore);
  holds.sort(byRankThenScore);

  // 応募候補が最低件数に満たない場合、保留から上位を昇格させる
  // （本来はS/Aランクでないため、枠埋めであることが分かるようフラグを付ける。
  //  金額未確認の案件は枠埋めの対象にもしない）
  while (candidates.length < MIN_CANDIDATES) {
    const idx = holds.findIndex(h => !h.priceUnverified);
    if (idx === -1) break;
    const promoted = holds.splice(idx, 1)[0];
    promoted.promoted = true;
    candidates.push(promoted);
  }

  return {
    candidates: candidates.slice(0, MAX_JOBS),
    holds: holds.slice(0, MAX_HOLDS),
    excluded,
  };
}

module.exports = {
  evaluateJob,
  classifyJobs,
  toStars,
  parsePriceToYen,
  normalizeFullWidthDigits,
  detectExtremeLowUnitPrice,
  computeSnsProposalAdjustment,
  computeClientRiskDelta,
  computeExperienceAdjustment,
};
