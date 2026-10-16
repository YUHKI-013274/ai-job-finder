// ゆうきの既存ポートフォリオURL台帳（正式な既存情報）。
//
// Knowledgeの正規データ（yuki_sales_knowledge_v1.md）はURLを持たないため、URLだけをここに登録する。
// このファイルはKnowledge同期チェック（ハッシュ照合）の対象外で、案件分析（Stage1）の判定には使わない。
// Work依頼用プロンプトの【ポートフォリオ】欄で、Application Packetが「その案件に関連する資産」として
// 挙げた候補（portfolioCandidates）のうち、assetNameがmatchAssetNameIncludesのいずれかを含むものにだけ
// URLを付ける（関連しない案件にはそもそも候補が出ないため、URLも出ない）。
// 応募文では、関連性が最も高いものを最大1URLだけ使う（Work側への指示）。
module.exports = {
  portfolios: [
    {
      id: 'design',
      label: '画像制作',
      url: 'https://yuki-sales-site-v1.vercel.app/design',
      matchAssetNameIncludes: ['AI画像'],
      registeredAt: '2026-10-13',
      source: '永峯勇気の指定',
    },
    {
      id: 'writing',
      label: 'ライティング',
      url: 'https://yuki-sales-site-v1.vercel.app/writing',
      matchAssetNameIncludes: ['AIライティング'],
      registeredAt: '2026-10-13',
      source: '永峯勇気の指定',
    },
    {
      id: 'improvement',
      label: 'AI活用・業務改善・資料制作',
      url: 'https://yuki-sales-site-v1.vercel.app/improvement',
      matchAssetNameIncludes: ['飲食事業改善', 'GPTs', 'Claude Code Knowledge DB', '朝礼自動化'],
      registeredAt: '2026-10-13',
      source: '永峯勇気の指定',
    },
  ],
};
