const {
  EXCLUDE_PATTERNS,
  CATEGORY_TIERS,
  BEGINNER_PATTERNS,
  SUPPORT_PATTERNS,
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

// ①ライティングとの一致度：ジャンルを判定する（配列の並び順＝優先順位が高い順）
function detectCategoryTier(text) {
  for (const tier of CATEGORY_TIERS) {
    if (containsAny(text, tier.patterns)) return tier;
  }
  return { tier: 'other', label: 'その他', score: 2, patterns: [] };
}

// ②ゆうきとの適性：AI活用・ライティング関連の強みキーワードの一致量
function computeAptitudeScore(aiFriendlyMatches, categoryInfo) {
  let score = 1 + Math.min(3, aiFriendlyMatches.length);
  if (categoryInfo.tier === 'writing' || categoryInfo.tier === 'design') score += 1;
  return Math.min(5, score);
}

// ③受注できる可能性：サポート体制・信頼性・応募者数などから判定（未経験歓迎は含めない＝⑦で別途評価）
function computeWinScore(text, supportMatches, trustMatches) {
  let score = 3;
  if (supportMatches.length > 0) score += 1;
  if (trustMatches.length > 0) score += 1;
  if (/小規模|少量|お試し|トライアル/.test(text)) score += 1;
  if (/実績\s*\d+\s*件以上/.test(text)) score -= 1;
  const appMatch = text.match(/(\d+)\s*人が応募/);
  if (appMatch && parseInt(appMatch[1], 10) > 20) score -= 1;
  return Math.min(5, Math.max(1, score));
}

// ④実績作りになるか：現在のポートフォリオ（ライティング・AI活用）との相性
function computePortfolioScore(categoryInfo, aptitudeScore) {
  if (categoryInfo.tier === 'writing') return 5;
  if (categoryInfo.tier === 'design') return aptitudeScore >= 3 ? 4 : 3;
  if (categoryInfo.tier === 'normal') return 2;
  return 1;
}

// ⑥単価：金額が高いほど加点（不明な場合は中間点）
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
  if (beginnerMatches.length === 0) return false;
  if (priceYen !== null && priceYen < 1000) return false;
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

  // ①ライティングとの一致度（最優先）
  const categoryInfo = detectCategoryTier(text);

  // ②ゆうきとの適性
  const aiFriendlyMatches = matchPatterns(text, AI_FRIENDLY_KEYWORDS);
  const technicalMatches = matchPatterns(text, AI_TECHNICAL_KEYWORDS);
  const aptitudeScore = computeAptitudeScore(aiFriendlyMatches, categoryInfo);

  // ③受注できる可能性
  const supportMatches = matchPatterns(text, SUPPORT_PATTERNS);
  const trustMatches = matchPatterns(text, CLIENT_TRUST_PATTERNS);
  const winScore = computeWinScore(text, supportMatches, trustMatches);

  // ④実績作りになるか
  const portfolioScore = computePortfolioScore(categoryInfo, aptitudeScore);

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
  const caution = buildCaution(text, technicalMatches, aiFriendlyMatches, categoryInfo);

  // 提案文の強み
  const strengthHint = buildStrengthHint(text, categoryInfo);

  return {
    ...job,
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

function buildCaution(text, technicalMatches, aiFriendlyMatches, categoryInfo) {
  const cautions = [];
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

function buildStrengthHint(text, categoryInfo) {
  if (categoryInfo.tier === 'writing') return STRENGTH_HINTS.writing;
  if (/採用|面接|人事/.test(text)) return STRENGTH_HINTS.management;
  if (/マニュアル|業務改善|仕組み|自動化/.test(text)) return STRENGTH_HINTS.operations;
  if (/Notion/.test(text)) return STRENGTH_HINTS.notion;
  if (/ChatGPT|Claude|生成AI|AI活用|AI導入/.test(text)) return STRENGTH_HINTS.ai;
  if (/未経験|初心者/.test(text)) return STRENGTH_HINTS.beginner;
  return STRENGTH_HINTS.general;
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

    if (job.rank === 'S' || job.rank === 'A') {
      candidates.push(job);
    } else {
      holds.push(job);
    }
  }

  candidates.sort(byRankThenScore);
  holds.sort(byRankThenScore);

  // 応募候補が最低件数に満たない場合、保留から上位を昇格させる
  // （本来はS/Aランクでないため、枠埋めであることが分かるようフラグを付ける）
  while (candidates.length < MIN_CANDIDATES && holds.length > 0) {
    const promoted = holds.shift();
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
