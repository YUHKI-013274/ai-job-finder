// Application Packet（応募準備パケット）生成
//
// Stage1（data/private/job_analysis/）とStage2（data/private/job_ai_analysis/、存在する場合のみ）の
// 結果から、後工程（応募文生成・CrowdWorks応募フォーム入力）がそのまま利用できる構造化データを
// 案件ごとに1ファイルへまとめる。Stage0・Stage1・Stage2のファイル自体は一切変更せず、内容を
// 複製ではなく参照（sourceFiles）＋必要最小限の抜粋として組み立てる。
//
// 対象案件：Stage1のrecommendationがstop以外（proposalGenerationAllowed === true）の案件のみ。
// stop案件（応募非推奨）はStage1自体が応募材料を抑制しているため、ここでも生成しない
// （既存の応募候補判定＝Stage1のrecommendationをそのまま尊重する）。
//
// 存在しない事実は補完しない。Stage1・Stage2に無い情報はStage1が既に使っている
// status表現（requires_analysis／not_found／unavailable等）をそのまま引き継ぐ。
const fs = require('fs');
const path = require('path');
const { loadJobAnalysis } = require('./analysis-store');
const { loadJobAiAnalysis, JOB_AI_ANALYSIS_FAILED_DIR } = require('./ai-analysis-store');
const { saveApplicationPacket } = require('./application-packet-store');

const PACKET_VERSION = 'application-packet-v1';

function nowIso() {
  return new Date().toISOString();
}

// 同一jobIdの失敗記録は複数あり得る（試行のたびにタイムスタンプ付きで保存されるため）。
// ファイル名にISOタイムスタンプを含むため、文字列ソートの末尾が最新の失敗になる。
function findLatestFailedAttempt(jobId) {
  if (!fs.existsSync(JOB_AI_ANALYSIS_FAILED_DIR)) return null;
  const files = fs.readdirSync(JOB_AI_ANALYSIS_FAILED_DIR)
    .filter(f => f.startsWith(`${jobId}_`) && f.endsWith('.json'))
    .sort();
  if (files.length === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(JOB_AI_ANALYSIS_FAILED_DIR, files[files.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

// Stage2は「未実行」「失敗」「成功」のいずれかの状態を必ず明示する（無言で欠落させない）。
function buildStage2Section(jobId) {
  const success = loadJobAiAnalysis(jobId);
  if (success) {
    return { status: 'success', analyzedAt: success.analyzedAt, output: success.output };
  }
  const failed = findLatestFailedAttempt(jobId);
  if (failed) {
    return { status: 'failed', attemptedAt: failed.attemptedAt, error: failed.lastError };
  }
  return { status: 'not_run' };
}

function buildConcerns(stage1) {
  const flaggedSafetyReview = Object.entries(stage1.safetyReview || {})
    .filter(([, v]) => v && v.status && v.status !== 'no_signal_detected')
    .map(([field, v]) => ({ field, status: v.status, evidence: v.evidence || [] }));

  const toolIssues = ((stage1.toolFit && stage1.toolFit.perTool) || [])
    .filter(t => t.status !== 'met');

  return {
    toolMismatchNote: stage1.toolMismatchNote || null,
    toolIssues,
    flaggedSafetyReview,
  };
}

// ===== 1案件分のApplication Packetを生成 =====
function buildApplicationPacket(jobId) {
  const stage1 = loadJobAnalysis(jobId);
  if (!stage1) {
    return { jobId, built: false, reason: 'Stage1分析結果（data/private/job_analysis/）が見つからない' };
  }
  if (stage1.proposalGenerationAllowed !== true) {
    return {
      jobId,
      built: false,
      reason: `Stage1のrecommendationが${stage1.recommendation.value}のため対象外（応募非推奨）`,
    };
  }

  const stage2 = buildStage2Section(jobId);

  const packet = {
    jobId,
    packetVersion: PACKET_VERSION,
    generatedAt: nowIso(),
    sourceFiles: {
      jobDetail: stage1.sourceFiles.jobDetail,
      stage1Analysis: `data/private/job_analysis/${jobId}.json`,
      stage2Analysis: stage2.status === 'success' ? `data/private/job_ai_analysis/${jobId}.json` : null,
    },
    job: {
      title: stage1.jobSummary.title,
      url: stage1.jobSummary.url,
      price: stage1.jobSummary.price,
      deadline: stage1.jobSummary.deadline,
      description: stage1.aiHandoff.input.jobDescriptionFull,
    },
    client: stage1.clientInfo,
    evaluation: {
      rank: stage1.searchSystemReevaluation.rank,
      applyCategory: stage1.jobSummary.currentTier,
      capabilityStatus: stage1.searchSystemReevaluation.capabilityStatus,
      evidenceType: stage1.searchSystemReevaluation.evidenceType,
    },
    recommendation: stage1.recommendation,
    concerns: buildConcerns(stage1),
    requiredCapabilities: stage1.searchSystemReevaluation.matchedCapabilities || [],
    usableExperience: stage1.usableExperience || [],
    clientValue: stage1.clientValue || [],
    applicationQuestions: {
      requiredConditions: stage1.conditions.required,
      responseItems: stage1.conditions.responseItems,
      requiredAnswers: stage1.proposalMaterials.requiredAnswers || [],
    },
    usableFactsForProposal: {
      centralMessage: stage1.proposalMaterials.centralMessage,
      usableEvidenceIds: stage1.proposalMaterials.usableEvidenceIds || [],
      portfolioCandidates: stage1.portfolioCandidates || [],
      avoidExpressions: stage1.proposalMaterials.avoidExpressions || [],
      prohibitedClaims: stage1.proposalMaterials.prohibitedClaims || [],
    },
    missingInformation: stage1.missingInformation || [],
    stage2,
  };

  saveApplicationPacket(jobId, packet);
  return { jobId, built: true, packet };
}

// ===== オーケストレーション: Stage1結果一覧からApplication Packetをまとめて生成 =====
// stage1Results は analyzer.analyzeAllPendingJobDetails() の戻り値をそのまま渡す想定
// （{jobId, analyzed, recommendation, proposalGenerationAllowed} または {jobId, analyzed:false, skipReason}の配列）。
function buildApplicationPacketsFromStage1Results(stage1Results) {
  const targets = (stage1Results || []).filter(r => r.analyzed && r.proposalGenerationAllowed === true);
  const results = targets.map(t => buildApplicationPacket(t.jobId));
  const builtCount = results.filter(r => r.built).length;
  return {
    targetCount: targets.length,
    builtCount,
    skippedCount: results.length - builtCount,
    results,
  };
}

module.exports = {
  PACKET_VERSION,
  findLatestFailedAttempt,
  buildStage2Section,
  buildConcerns,
  buildApplicationPacket,
  buildApplicationPacketsFromStage1Results,
};
