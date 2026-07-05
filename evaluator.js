const {
  EXCLUDE_PATTERNS,
  PHASE0_PRIORITY_PATTERNS,
  CONTINUITY_PATTERNS,
  CLIENT_TRUST_PATTERNS,
  RISK_PATTERNS,
  MIN_PRICE_YEN,
  MIN_CANDIDATES,
  AI_FRIENDLY_KEYWORDS,
  AI_TECHNICAL_KEYWORDS,
  STRENGTH_HINTS,
  CURRENT_PHASE,
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
  const re = /([\d,]+)\s*(万)?\s*円?/g;
  const values = [];
  let match;
  while ((match = re.exec(priceStr)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    if (!numStr) continue;
    let num = parseInt(numStr, 10);
    if (Number.isNaN(num)) continue;
    if (match[2] === '万') num *= 10000;
    values.push(num);
  }
  return values.length > 0 ? Math.min(...values) : null;
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

  // AI関連スコア（今の強みを活かせるものだけ加点。技術系は加点せず注意喚起のみ）
  const aiFriendlyMatches = matchPatterns(text, AI_FRIENDLY_KEYWORDS);
  const technicalMatches = matchPatterns(text, AI_TECHNICAL_KEYWORDS);
  const aiScore = Math.min(5, aiFriendlyMatches.length) * CURRENT_PHASE.aiWeight;

  // 受注しやすさ・安全性スコア（未経験OK・マニュアル完備・クライアント信頼性の目印の数）
  const priorityMatches = matchPatterns(text, PHASE0_PRIORITY_PATTERNS);
  const trustMatches = matchPatterns(text, CLIENT_TRUST_PATTERNS);
  const priorityScore = Math.min(5, priorityMatches.length + trustMatches.length) * CURRENT_PHASE.priorityWeight;

  // 継続案件ボーナス（一度受注できれば実績を積み上げやすい）
  const continuityMatches = matchPatterns(text, CONTINUITY_PATTERNS);
  const continuityScore = (continuityMatches.length > 0 ? 1 : 0) * CURRENT_PHASE.continuityWeight;

  // 受注可能性スコア（未経験歓迎・マニュアル完備ほど高く、経験要件があるほど低い）
  let winScore = 3;
  if (/実績\s*\d+\s*件以上/.test(text)) winScore -= 1;
  if (/初心者|未経験|初めて/.test(text)) winScore += 2;
  if (/マニュアル(あり|完備|整備)/.test(text)) winScore += 1;
  if (/小規模|少量|お試し/.test(text)) winScore += 1;
  winScore = Math.min(5, Math.max(1, winScore));

  // 総合スコア（フェーズの重み付けを反映）
  const totalScore = priorityScore + continuityScore + aiScore + winScore;

  let rank;
  if (totalScore >= 15) {
    rank = 'S';
  } else if (totalScore >= 10) {
    rank = 'A';
  } else if (totalScore >= 6) {
    rank = 'B';
  } else {
    rank = 'C';
  }

  // 案件ジャンル判定
  const genre = detectGenre(text);

  // 高評価の理由（✓チェックリスト形式で可視化）
  const matchedSignals = buildMatchedSignals(priorityMatches, continuityMatches, aiFriendlyMatches, trustMatches);
  const reason = matchedSignals.length > 0
    ? matchedSignals.map(s => `✓ ${s}`).join('\n')
    : '安全に完了できそうな案件（実績作りとして検討可）';

  // 注意点
  const caution = buildCaution(text, technicalMatches, aiFriendlyMatches);

  // 提案文の強み
  const strengthHint = buildStrengthHint(text);

  return {
    ...job,
    genre,
    aiScore,
    priorityScore,
    continuityScore,
    winScore,
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

function detectGenre(text) {
  if (/ChatGPT|Claude|GPTs?|生成AI|AI活用|AI導入|AI業務/.test(text)) return 'AI活用・生成AI';
  if (/AI画像|画像生成|Midjourney|Stable Diffusion/.test(text)) return 'AI画像生成';
  if (/AI漫画|漫画生成/.test(text)) return 'AI漫画';
  if (/Notion/.test(text)) return 'Notion構築';
  if (/採用|面接|人事/.test(text)) return '採用支援';
  if (/マニュアル|手順書|業務フロー/.test(text)) return 'マニュアル作成';
  if (/業務改善|業務効率|仕組み化|自動化/.test(text)) return '業務改善・自動化';
  if (/Canva|SNS運用|SNS投稿/.test(text)) return 'SNS・画像制作';
  if (/データ入力/.test(text)) return 'データ入力';
  if (/ライター|記事|コンテンツ/.test(text)) return 'ライティング';
  if (/リサーチ|調査/.test(text)) return 'リサーチ';
  return 'その他';
}

// マッチした信号をラベルの重複を除いて1つの配列にまとめる（表示用チェックリスト）
function buildMatchedSignals(priorityMatches, continuityMatches, aiFriendlyMatches, trustMatches) {
  const seen = new Set();
  const signals = [];
  for (const list of [priorityMatches, continuityMatches, aiFriendlyMatches, trustMatches]) {
    for (const p of list) {
      const label = String(p);
      if (!seen.has(label)) {
        seen.add(label);
        signals.push(label);
      }
    }
  }
  // 短い語が別の長い語に完全に含まれる場合は、短い方を除いて表示を簡潔にする
  // （例: "ChatGPT"と"GPT"が両方マッチした場合は"ChatGPT"だけ表示）
  return signals.filter(label =>
    !signals.some(other => other !== label && other.length > label.length && other.includes(label))
  );
}

function buildCaution(text, technicalMatches, aiFriendlyMatches) {
  const cautions = [];
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

function buildStrengthHint(text) {
  if (/ChatGPT|Claude|生成AI|AI活用|AI導入/.test(text)) return STRENGTH_HINTS.ai;
  if (/採用|面接|人事/.test(text)) return STRENGTH_HINTS.management;
  if (/マニュアル|業務改善|仕組み|自動化/.test(text)) return STRENGTH_HINTS.operations;
  if (/Notion/.test(text)) return STRENGTH_HINTS.notion;
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
