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
} = require('./config');

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

// 案件の報酬表記（例: "¥3,000〜5,000" "5万円" "3,000円〜5,000円"）から
// 最低金額（円）を推定する。読み取れない場合は null を返す。
function parsePriceToYen(priceStr) {
  if (!priceStr || /要確認/.test(priceStr)) return null;
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

// 報酬が「要確認」「成果報酬のみ」等ではないが、応相談などで金額を確定できない表記かどうか
function isPriceAmbiguous(priceStr) {
  if (!priceStr) return true;
  return containsAny(priceStr, AMBIGUOUS_PRICE_PATTERNS);
}

// ジャンル判定の最低スコア。タイトル一致1件（weight 3）か、本文一致2件以上（weight 2）が
// なければ「その他」とし、本文に単語が1回含まれるだけで代表ジャンルにしない。
const MIN_CATEGORY_WEIGHT = 2;

// ①ライティングとの一致度：ジャンルを判定する。
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

// ②ゆうきとの適性：AI活用・ライティング関連の強みキーワードの一致量
function computeAptitudeScore(aiFriendlyMatches, categoryInfo) {
  let score = 1 + Math.min(3, aiFriendlyMatches.length);
  if (categoryInfo.tier === 'writing' || categoryInfo.tier === 'design') score += 1;
  return Math.min(5, score);
}

// ③受注できる可能性：サポート体制・信頼性・応募者数・経験条件などから判定
// （未経験歓迎そのものは含めない＝⑦で別途評価。経験者歓迎は軽度減点）
function computeWinScore(text, supportMatches, trustMatches, experiencePreferredMatches) {
  let score = 3;
  if (supportMatches.length > 0) score += 1;
  if (trustMatches.length > 0) score += 1;
  if (/小規模|少量|お試し|トライアル/.test(text)) score += 1;
  if (/実績\s*\d+\s*件以上/.test(text)) score -= 1;
  if (experiencePreferredMatches.length > 0) score -= 1;
  const appMatch = text.match(/(\d+)\s*人が応募/);
  if (appMatch && parseInt(appMatch[1], 10) > 20) score -= 1;
  return Math.min(5, Math.max(1, score));
}

// ④実績作りになるか：ライティング案件は現在の制作実績との一致度（高/中/低）で判定し、
// 「ライティングなら一律満点」にならないようにする。他ジャンルはこれまで通りの簡易判定。
function computePortfolioScore(categoryInfo, aptitudeScore, text) {
  if (categoryInfo.tier === 'writing') {
    for (const fit of PORTFOLIO_FIT_TIERS) {
      if (containsAny(text, fit.patterns)) return fit.score;
    }
    return 3; // 分類できない一般的なライティング案件は中程度の一致度とする
  }
  if (categoryInfo.tier === 'design') return aptitudeScore >= 3 ? 4 : 3;
  if (categoryInfo.tier === 'normal') return 2;
  return 1;
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

// Sランクは「ライティング案件かつ、受注しやすく実績になる」場合のみに限定する
function meetsSRankConditions({ categoryInfo, beginnerMatches, continuityMatches, winScore, priceYen, text }) {
  if (categoryInfo.tier !== 'writing') return false;
  if (priceYen === null || priceYen < 1000) return false;
  if (beginnerMatches.length === 0) return false;
  const isOneOff = /単発|1回限り|一度のみ|一度きり/.test(text);
  if (continuityMatches.length === 0 && isOneOff) return false;
  if (winScore < 4) return false;
  return true;
}

function totalScoreToRank(totalScore) {
  if (totalScore >= 58) return 'S';
  if (totalScore >= 44) return 'A';
  if (totalScore >= 30) return 'B';
  return 'C';
}

function evaluateJob(job) {
  const text = `${job.title} ${job.description || ''}`;

  if (containsAny(text, RISK_PATTERNS)) {
    return { ...job, excluded: true, excludeReason: 'リスクあり' };
  }

  const priceYen = parsePriceToYen(job.price);
  if (priceYen !== null && priceYen < MIN_PRICE_YEN) {
    return { ...job, excluded: true, excludeReason: '単価が低すぎる', priceYen };
  }

  if (containsAny(text, EXCLUDE_PATTERNS)) {
    return { ...job, excluded: true, excludeReason: '条件不一致', priceYen };
  }

  // 報酬が「要確認」／パース不能／応相談等で金額を確認できない場合は、
  // 応募候補（TOP5）には入れず保留に回す（classifyJobsで制御するためのフラグ）
  const priceUnverified = priceYen === null || isPriceAmbiguous(job.price);

  // ①ライティングとの一致度（最優先）。タイトル/本文の一致数で中心業務を判定する
  const categoryInfo = detectCategoryTier(job);

  // ②ゆうきとの適性
  const aiFriendlyMatches = matchPatterns(text, AI_FRIENDLY_KEYWORDS);
  const technicalMatches = matchPatterns(text, AI_TECHNICAL_KEYWORDS);
  const aptitudeScore = computeAptitudeScore(aiFriendlyMatches, categoryInfo);

  // ③受注できる可能性（経験者歓迎は軽度減点、未経験歓迎とは区別する）
  const supportMatches = matchPatterns(text, SUPPORT_PATTERNS);
  const trustMatches = matchPatterns(text, CLIENT_TRUST_PATTERNS);
  const experiencePreferredMatches = matchPatterns(text, EXPERIENCE_PREFERRED_PATTERNS);
  const winScore = computeWinScore(text, supportMatches, trustMatches, experiencePreferredMatches);

  // ④実績作りになるか（案件ごとの制作実績一致度で判定）
  const portfolioScore = computePortfolioScore(categoryInfo, aptitudeScore, text);

  // ⑤継続性
  const continuityMatches = matchPatterns(text, CONTINUITY_PATTERNS);
  const continuityScore = continuityMatches.length > 0 ? 5 : 2;

  // ⑥単価
  const priceScore = computePriceScore(priceYen);

  // ⑦未経験歓迎（最も軽い重み。単独では高評価にしない）
  const beginnerMatches = matchPatterns(text, BEGINNER_PATTERNS);
  const beginnerScore = beginnerMatches.length > 0 ? 5 : 2;

  // 総合スコア（①〜⑦の優先順位をそのまま重みに反映）
  const totalScore =
    categoryInfo.score * WEIGHTS.category +
    aptitudeScore * WEIGHTS.aptitude +
    winScore * WEIGHTS.win +
    portfolioScore * WEIGHTS.portfolio +
    continuityScore * WEIGHTS.continuity +
    priceScore * WEIGHTS.price +
    beginnerScore * WEIGHTS.beginner;

  let rank = totalScoreToRank(totalScore);

  // Sランクはライティング案件かつ受注しやすく実績になる場合のみ（他ジャンルはA以下に降格）
  if (rank === 'S' && !meetsSRankConditions({ categoryInfo, beginnerMatches, continuityMatches, winScore, priceYen, text })) {
    rank = 'A';
  }
  // 動画編集・撮影・音声系は未経験歓迎でも高評価にしない（S/Aには乗せない）
  if (categoryInfo.tier === 'low' && (rank === 'S' || rank === 'A')) {
    rank = 'B';
  }

  const genre = categoryInfo.label;

  // 高評価の理由（★の数で重要度が分かる形式で可視化）
  const matchedSignals = buildWeightedSignals({
    categoryInfo, portfolioScore, aptitudeScore, beginnerMatches, continuityMatches,
    winScore, trustMatches, aiFriendlyMatches,
  });
  const reason = matchedSignals.length > 0
    ? matchedSignals.map(s => `${toStars(s.stars)} ${s.label}`).join('\n')
    : '安全に完了できそうな案件（実績作りとして検討可）';

  // 注意点
  const caution = buildCaution(text, technicalMatches, aiFriendlyMatches, categoryInfo, priceUnverified, experiencePreferredMatches);

  // 提案文の強み（案件内容に応じて使い分ける）
  const strengthHint = buildStrengthHint(text, categoryInfo);

  return {
    ...job,
    // 検索キーワード（scraper.jsが検索に使った語）ではなく、実際の中心業務と一致するキーワードを表示する
    matchedKeyword: categoryInfo.representative || job.matchedKeyword,
    genre,
    categoryTier: categoryInfo.tier,
    categoryScore: categoryInfo.score,
    aptitudeScore,
    winScore,
    portfolioScore,
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
  };
}

// マッチした信号を★の数（重要度）付きでまとめる（表示用チェックリスト）
function buildWeightedSignals({ categoryInfo, portfolioScore, aptitudeScore, beginnerMatches, continuityMatches, winScore, trustMatches, aiFriendlyMatches }) {
  const signals = [];
  signals.push({ label: categoryInfo.label, stars: categoryInfo.score });

  if (categoryInfo.tier === 'writing' || categoryInfo.tier === 'design') {
    signals.push({ label: '現在のポートフォリオが活用できる', stars: portfolioScore });
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

function buildCaution(text, technicalMatches, aiFriendlyMatches, categoryInfo, priceUnverified, experiencePreferredMatches) {
  const cautions = [];
  if (priceUnverified) {
    cautions.push('報酬額が確認できないため応募候補（TOP5）には入れていません。案件詳細で金額を確認してから判断してください');
  }
  if (experiencePreferredMatches.length > 0) {
    cautions.push('「経験者歓迎」の記載があり、未経験だと採用されにくい可能性があります');
  }
  if (categoryInfo.tier === 'low') {
    cautions.push('優先度の低いジャンル（動画編集・撮影・音声系）の案件です。他に良い案件がない場合のみ検討してください');
  }
  if (technicalMatches.length > 0 && aiFriendlyMatches.length === 0) {
    cautions.push('本格的なエンジニアリング経験を求められる可能性があります（優先度低）');
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

module.exports = { evaluateJob, classifyJobs, toStars, parsePriceToYen };
