const {
  EXCLUDE_PATTERNS,
  DOWNGRADE_PATTERNS,
  S_RANK_KEYWORDS,
  A_RANK_KEYWORDS,
  STRENGTH_HINTS,
} = require('./config');

function toStars(score, max = 5) {
  const filled = Math.round(Math.min(max, Math.max(0, score)));
  return '★'.repeat(filled) + '☆'.repeat(max - filled);
}

function containsAny(text, patterns) {
  const lower = text.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

function evaluateJob(job) {
  const text = `${job.title} ${job.description || ''}`;

  // 除外チェック
  if (containsAny(text, EXCLUDE_PATTERNS)) {
    job.excluded = true;
    return job;
  }

  // 降格フラグ（ランク計算後に強制C扱い）
  const shouldDowngrade = containsAny(text, DOWNGRADE_PATTERNS);

  // AI実績スコア（S/Aランクキーワード×AI関連度）
  const sMatch = S_RANK_KEYWORDS.filter(k => text.toLowerCase().includes(k.toLowerCase())).length;
  const aMatch = A_RANK_KEYWORDS.filter(k => text.toLowerCase().includes(k.toLowerCase())).length;

  const aiScore = Math.min(5, sMatch * 2 + aMatch);

  // 独立・AI事業つながりスコア
  const independenceScore = Math.min(5, sMatch * 2 + (aMatch > 0 ? 1 : 0));

  // 受注可能性スコア（実績要件が低いほど高い）
  let winScore = 3;
  if (/実績\s*\d+\s*件以上/.test(text)) winScore -= 2;
  if (/経験者|エンジニア経験/.test(text)) winScore -= 1;
  if (/初心者|未経験|初めて/.test(text)) winScore += 1;
  if (/小規模|少量/.test(text)) winScore += 1;
  winScore = Math.min(5, Math.max(1, winScore));

  // 難易度（逆算：低い難易度=高いスコア）
  let difficultyScore = 3;
  if (sMatch > 0) difficultyScore = 3;
  if (/専門|エンジニア|プログラミング必須/.test(text)) difficultyScore = 5;
  if (/簡単|シンプル|基本|入力|リサーチ/.test(text)) difficultyScore = 1;
  difficultyScore = Math.min(5, Math.max(1, difficultyScore));

  // 総合ランク
  const totalScore = aiScore + independenceScore + winScore - (difficultyScore - 3) * 0.5;
  let rank;
  if (shouldDowngrade) {
    rank = 'C';
  } else if (totalScore >= 10 && sMatch > 0) {
    rank = 'S';
  } else if (totalScore >= 7 || aMatch > 0) {
    rank = 'A';
  } else if (totalScore >= 4) {
    rank = 'B';
  } else {
    rank = 'C';
  }

  // 案件ジャンル判定
  const genre = detectGenre(text);

  // 応募すべき理由
  const reason = buildReason(text, sMatch, aMatch, genre);

  // 注意点
  const caution = buildCaution(text);

  // 提案文の強み
  const strengthHint = buildStrengthHint(text);

  return {
    ...job,
    genre,
    aiScore,
    independenceScore,
    winScore,
    difficultyScore,
    rank,
    reason,
    caution,
    strengthHint,
    excluded: false,
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
  if (/ライター|記事|コンテンツ/.test(text)) return 'ライティング';
  if (/リサーチ|調査/.test(text)) return 'リサーチ';
  return 'その他';
}

function buildReason(text, sMatch, aMatch, genre) {
  const reasons = [];
  if (sMatch > 0) reasons.push('AI活用スキルを直接活かせる案件');
  if (/初心者|未経験/.test(text)) reasons.push('初心者歓迎で受注しやすい');
  if (/業務改善|仕組み/.test(text)) reasons.push('飲食業界22年の業務改善経験を活かせる');
  if (/採用|面接/.test(text)) reasons.push('300名以上の採用面接経験が強みになる');
  if (/Notion/.test(text)) reasons.push('Notion活用スキルを実績化できる');
  if (aMatch > 0 && reasons.length === 0) reasons.push('AI事業ポートフォリオとして実績を積める');
  if (reasons.length === 0) reasons.push('ゆうきの管理・整理スキルを活かせる可能性がある');
  return reasons.join('、');
}

function buildCaution(text) {
  const cautions = [];
  if (/実績\s*\d+\s*件以上/.test(text)) cautions.push('実績件数の要件を確認して応募を判断');
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
  return STRENGTH_HINTS.general;
}

function rankAndSelect(jobs, maxJobs = 10) {
  const evaluated = jobs.map(evaluateJob).filter(j => !j.excluded);

  const rankOrder = { S: 0, A: 1, B: 2, C: 3 };
  evaluated.sort((a, b) => {
    const rankDiff = rankOrder[a.rank] - rankOrder[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return (b.aiScore + b.independenceScore) - (a.aiScore + a.independenceScore);
  });

  return evaluated.slice(0, maxJobs);
}

module.exports = { evaluateJob, rankAndSelect, toStars };
