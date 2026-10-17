// 案件本文（全文）から、応募可否・契約条件に関わる重要事項を機械的に検出する（AI不使用・正規表現のみ）。
//   - 年齢条件（応募者自身の年齢・年代を求める表現。読者層の説明は除く）
//   - 特殊な応募方式（応募画面の条件欄への指定入力、外部フォーム、必ず記載する語など）
//   - 稼働条件（「週N時間以上」「平日9〜17時」など具体的な拘束）
//   - 必須提出物（ポートフォリオ・制作実績の提示が必須で、その種類が分かるもの）
// 検出した結果は「要確認」の判断材料にするだけで、案件を自動で除外はしない。
// Knowledge・評価スコアは参照しない（種類ごとの手持ち資産の対応表だけをここに持つ）。

function normalizeDigits(str) {
  return String(str || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function toLines(text) {
  return normalizeDigits(text).split(/\r?\n/).map(l => l.trim());
}

function excerpt(line, max = 70) {
  const s = String(line || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ===== 年齢条件 =====
// hard：応募者自身の年齢・年代を限定／中心にする表現（例：「20代〜30代前半の方」「20代の方中心」「30歳以下」）
// soft：歓迎レベルの表現（例：「20代歓迎」）。要確認にはせず、注意として残す。
// 「20代向けメディア」「20代が読んで」等の読者層の説明は対象にしない（「の方」を伴わないため一致しない）。
const AGE_HARD_PATTERNS = [
  /\d{2}\s*代(?:\s*[〜~～\-－]\s*\d{2}\s*代)?\s*(?:前半|後半)?\s*(?:の方|の人|の女性|の男性)(?!\s*(?:に向け|向け|が読|へ))/,
  /\d{2}\s*代(?:\s*[〜~～\-－]\s*\d{2}\s*代)?\s*(?:前半|後半)?\s*(?:限定|のみ|まで|に限る|に限ります)/,
  /\d{2}\s*歳\s*(?:以上|以下|未満|まで|から|〜|~)/,
  /年齢\s*(?:制限|条件)\s*[:：]?\s*(?!なし|不問|無し|ありません)\S/,
];
const AGE_SOFT_PATTERNS = [/\d{2}\s*代\s*(?:歓迎|優遇|大歓迎)/];

function detectAgeCondition(text) {
  const lines = toLines(text);
  let soft = null;
  for (const line of lines) {
    if (/年齢[^。\n]{0,6}(?:不問|問いません|制限なし)/.test(line)) continue;
    for (const re of AGE_HARD_PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      // 「20代の方歓迎」のように直後が歓迎表現なら、限定ではなく歓迎レベルとして扱う
      const after = line.slice(m.index + m[0].length);
      if (/^\s*[（(]?\s*(?:歓迎|優遇|大歓迎)/.test(after)) {
        if (!soft) soft = { detected: true, level: 'soft', matched: m[0], excerpt: excerpt(line) };
        continue;
      }
      return { detected: true, level: 'hard', matched: m[0], excerpt: excerpt(line) };
    }
  }
  if (soft) return soft;
  for (const line of lines) {
    for (const re of AGE_SOFT_PATTERNS) {
      const m = line.match(re);
      if (m) return { detected: true, level: 'soft', matched: m[0], excerpt: excerpt(line) };
    }
  }
  return { detected: false, level: null, matched: null, excerpt: null };
}

// ===== 特殊な応募方式 =====
const SPECIAL_APPLY_PATTERNS = [
  /新しい条件を提示/,
  /固定報酬で\s*[\d,]+\s*円/,
  /[\d,]+\s*円[^。\n]{0,6}(?:と|を)\s*入力/,
  /と入力して(?:ご)?応募/,
  /(?:Google\s*フォーム|グーグルフォーム|別途[^。\n]{0,12}フォーム|フォームに(?:ご)?(?:回答|入力))/,
  /件名に[^。\n]{0,30}(?:記載|入力)/,
  /(?:合言葉|キーワード)[^。\n]{0,20}(?:記載|入力|添え)/,
  /応募(?:時|の際)[^。\n]{0,40}(?:必ず|かならず)[^。\n]{0,30}(?:記載|入力|明記)/,
];

function detectSpecialApplyMethod(text) {
  const lines = toLines(text);
  const found = [];
  for (const line of lines) {
    if (SPECIAL_APPLY_PATTERNS.some(re => re.test(line))) found.push(excerpt(line));
    if (found.length >= 2) break;
  }
  return { detected: found.length > 0, excerpts: found };
}

// ===== 稼働条件（本人の稼働上限と照合できる形で検出する） =====
// 本人の前提（ゆうき申告 2026-10-18）：週3日程度ライスワークがある。通常案件は週15時間以内が目安（毎週の確約はできない）。
// 重点案件のみ、他のプロジェクトを調整した場合の上限として最大週20時間まで個別検討できる。
// 1日1〜2時間の自由な分割作業は対応可能。固定時間帯・長時間の連続拘束は対応可否を確認する。
// 「週4日以上」という条件だけでは除外しない。稼働条件が不明、または本人の確約が必要なものは「要確認」。
// 明確に対応不能と確認できる条件（週20時間を超える明示の最低稼働など）だけを「超過（excess）」として対象外にできる。
const AVAILABILITY = { normalWeeklyHours: 15, maxWeeklyHours: 20 };

const WORK_NUM = '(\\d+)\\s*(?:[〜~～\\-－]\\s*(\\d+))?';
const WORK_KIND = '\\s*(以上|以内|まで|程度|前後|[〜~～])?';
const WEEK_HOURS_RE = new RegExp(`週\\s*${WORK_NUM}\\s*時間${WORK_KIND}`);
const WEEK_DAYS_RE = new RegExp(`週\\s*${WORK_NUM}\\s*日${WORK_KIND}`);
const DAY_HOURS_RE = new RegExp(`(?<!\\d)1日\\s*${WORK_NUM}\\s*時間${WORK_KIND}`);
// 数値表現の直後（10字以内）に「目安・ご相談」などがあれば、必須ではなく緩い表現（soft）として扱う
const WORK_SOFT_AFTER = /(ご?相談|応相談|目安|程度|前後|くらい|でも可|でもOK|歓迎|可能であれば|できれば)/;

// 固定時間帯・連続拘束など（緩い表現を伴わないもの）
const WORK_FIXED_PATTERNS = [
  /(?:平日|土日|毎日|月[〜~～-]金)[^。\n]{0,14}\d{1,2}\s*(?:時|:\d{2})?\s*[〜~～-]\s*\d{1,2}\s*(?:時|:\d{2})/,
  /\d{1,2}\s*時\s*[〜~～-]\s*\d{1,2}\s*時[^。\n]{0,10}(?:稼働|対応|勤務|連絡)/,
  /(?:曜日|時間帯)[^。\n]{0,6}(?:固定|指定)/,
  /(?:リアルタイム|即レス|常時(?:連絡|対応))/,
];
const WORK_FIXED_SOFT = /(相談可|柔軟|フレックス|自由|いつでも|時間帯は問いません)/;
const WORK_QUESTION_RE = /(例）|例：|例:|ですか|ますか|教えて|雇用形態|現在お|現在の)/;

function pickField(current, candidate) {
  // 緩い表現でない（必須の）候補を優先し、同じ強さなら最初の候補を残す
  if (!current) return candidate;
  if (current.soft && !candidate.soft) return candidate;
  return current;
}

function parseWorkField(line, re) {
  const m = line.match(re);
  if (!m) return null;
  const kind = m[3] === undefined ? '' : (/^[〜~～]$/.test(m[3]) ? '以上' : m[3]);
  const after = line.slice(m.index + m[0].length, m.index + m[0].length + 10);
  const soft = WORK_SOFT_AFTER.test(after) || /^(程度|前後)$/.test(kind);
  return { min: Number(m[1]), max: m[2] ? Number(m[2]) : null, kind, soft, line };
}

// 戻り値のlevel（重い順）：excess（明示の最低稼働が週20時間超＝対象外にできる）／over（換算で週20時間超の見込み）／
// heavy（週15〜20時間）／fixed（固定時間帯・長時間拘束）／unknown_days（週4日以上だが時間が不明）／light／none
function detectWorkload(text) {
  const lines = toLines(text);
  let wh = null, dpw = null, hpd = null;
  const fixed = [];
  let monthHours = null;
  for (const line of lines) {
    // 応募者への質問文・記入例（「作業時間を教えてください 例）…」「現在の雇用形態（週35時間など）」）は条件ではない
    if (WORK_QUESTION_RE.test(line)) continue;
    const mh = line.match(/月\s*(\d+)\s*時間/);
    if (mh && !monthHours) monthHours = { hours: Number(mh[1]), line, soft: WORK_SOFT_AFTER.test(line.slice(mh.index + mh[0].length, mh.index + mh[0].length + 10)) };
    const a = parseWorkField(line, WEEK_HOURS_RE); if (a) wh = pickField(wh, a);
    const b = parseWorkField(line, WEEK_DAYS_RE); if (b) dpw = pickField(dpw, b);
    const c = parseWorkField(line, DAY_HOURS_RE); if (c) hpd = pickField(hpd, c);
    if (!WORK_FIXED_SOFT.test(line) && WORK_FIXED_PATTERNS.some(re => re.test(line))) fixed.push(excerpt(line));
  }

  let weeklyMin = null, weeklyMax = null, basis = null, soft = false, monthLine = null;
  if (wh) {
    basis = 'explicit'; soft = wh.soft;
    if (wh.kind === '以内' || wh.kind === 'まで') { weeklyMin = 0; weeklyMax = wh.max != null ? wh.max : wh.min; }
    else { weeklyMin = wh.min; weeklyMax = wh.max != null ? wh.max : (wh.kind === '以上' ? null : wh.min); }
  } else if (monthHours && !(hpd && dpw)) {
    // 「月100時間」など月あたりの稼働は、1か月＝約4.3週として週あたりに換算する（換算値なので超過は「要確認」止まり）
    basis = 'derived'; soft = monthHours.soft;
    weeklyMin = Math.round(monthHours.hours / 4.3); weeklyMax = weeklyMin;
    monthLine = monthHours.line;
  } else if (hpd && dpw) {
    basis = 'derived'; soft = hpd.soft || dpw.soft;
    weeklyMin = hpd.min * dpw.min;
    const hMax = hpd.max != null ? hpd.max : (hpd.kind === '以上' ? null : hpd.min);
    const dMax = dpw.max != null ? dpw.max : (dpw.kind === '以上' ? null : dpw.min);
    weeklyMax = hMax != null && dMax != null ? hMax * dMax : null;
  }

  const excerpts = [];
  const add = f => { if (f && !excerpts.includes(excerpt(f.line))) excerpts.push(excerpt(f.line)); };
  let level = 'none';
  const rank = { none: 0, light: 1, unknown_days: 2, fixed: 3, heavy: 4, over: 5, excess: 6 };
  const raise = lv => { if (rank[lv] > rank[level]) level = lv; };

  if (weeklyMin != null) {
    if (weeklyMin > AVAILABILITY.maxWeeklyHours) raise(basis === 'explicit' && !soft ? 'excess' : 'over');
    else if (weeklyMin > AVAILABILITY.normalWeeklyHours) raise('heavy');
    else if (weeklyMin === AVAILABILITY.normalWeeklyHours) raise(soft && wh && wh.kind !== '以上' ? 'light' : 'heavy');
    else raise('light');
    add(wh); if (basis === 'derived') { add(hpd); add(dpw); if (monthLine && !excerpts.includes(excerpt(monthLine))) excerpts.push(excerpt(monthLine)); }
  } else if (dpw && dpw.min >= 4 && !dpw.soft) {
    raise('unknown_days'); add(dpw);
  } else if (hpd && hpd.min >= 4 && !hpd.soft) {
    raise('fixed'); add(hpd); // 1日4時間以上の長時間拘束（週の日数は不明）
  } else if (wh || dpw || hpd) {
    raise('light');
  }
  if (fixed.length > 0) { raise('fixed'); fixed.forEach(f => { if (!excerpts.includes(f)) excerpts.push(f); }); }

  return {
    level, basis,
    weeklyHoursMin: weeklyMin, weeklyHoursMax: weeklyMax,
    flexibleHint: soft,
    excerpts: excerpts.slice(0, 3),
  };
}

// 旧API互換：具体的な拘束があるか（重さがlight/none以外）
function detectWorkConstraint(text) {
  const w = detectWorkload(text);
  return { detected: !['none', 'light'].includes(w.level), level: w.level, excerpts: w.excerpts };
}

// ===== 言語要件（英語など）。「必須」と「歓迎」を区別する =====
const LANG_NAMES = '(?:ビジネス英語|英語|英文|中国語|韓国語|フランス語|スペイン語|ドイツ語|TOEIC)';
const LANG_REQUIRED_RE = new RegExp(`${LANG_NAMES}[^。\\n]{0,14}(?:必須|必要|できる方|対応可能な方|が求められ|レベル|ネイティブ)`);
const LANG_SOFT_RE = /(歓迎|尚可|あれば|あると|優遇|できれば)/;

function detectLanguageRequirement(text) {
  const lines = toLines(text);
  let soft = null;
  for (const line of lines) {
    const m = line.match(LANG_REQUIRED_RE);
    if (!m) continue;
    if (LANG_SOFT_RE.test(line)) { if (!soft) soft = { detected: true, level: 'soft', excerpt: excerpt(line) }; continue; }
    return { detected: true, level: 'required', excerpt: excerpt(line) };
  }
  return soft || { detected: false, level: null, excerpt: null };
}

// ===== 報酬条件：詳細ページの表示・初回テスト報酬・本採用の報酬を区別して拾う（推測で補わない） =====
function parseYen(s) { return Number(String(s).replace(/,/g, '')); }

function detectPriceTerms(text) {
  const lines = toLines(text);
  let test = null, contract = null;
  for (const line of lines) {
    if (/入力|応募時/.test(line)) continue; // 応募画面への入力指示の金額は契約金額ではない
    const t = line.match(/(?:1件目|初回|最初|テスト)[^。\n]{0,24}?([\d,]+)\s*円/);
    if (t && /テスト/.test(line) && !test) { test = { yen: parseYen(t[1]), excerpt: excerpt(line) }; continue; }
    // 「2,000〜3,000円」のような範囲は、下限・上限の両方を保持する（上限だけを契約金額として拾わない）
    const c = line.match(/(?:契約金額|1(?:本|記事|件)あたり|時間単価|単価)[^。\n]{0,20}?([\d,]+)\s*(?:[〜~～\-－]\s*([\d,]+))?\s*円/);
    if (c && !contract && !/テスト/.test(line) && parseYen(c[1]) >= 100) {
      contract = { yen: parseYen(c[1]), yenMax: c[2] ? parseYen(c[2]) : null, estimated: /想定|程度|目安/.test(line), excerpt: excerpt(line) };
    }
  }
  return { test, contract };
}

// 報酬条件の表示用（範囲・想定を保ったまま文字列にする。範囲の片側だけを金額として示さない）
function formatTermYen(t) {
  if (!t) return '';
  return `${t.yen.toLocaleString()}円${t.yenMax ? `〜${t.yenMax.toLocaleString()}円` : ''}${t.estimated ? '（想定）' : ''}`;
}

// 詳細ページの報酬欄が「ワーカーと相談する」等で、金額が確定していないか
function classifyDetailPrice(price) {
  const raw = price && price.raw ? String(price.raw) : '';
  const unknown = !raw || /相談|要確認|未定|応相談/.test(raw) || !/\d/.test(raw);
  return { raw: raw || null, type: price && price.type ? price.type : null, unknown };
}

// ===== 作業量と報酬（判断材料の表示専用。自動除外には使わない） =====
function detectWorkloadPrice(text, terms) {
  if (!terms || !terms.contract) return null;
  const lines = toLines(text);
  for (const line of lines) {
    if (!/(1本|1記事|1件|あたり|文字数)/.test(line)) continue;
    const m = line.match(/(\d[\d,]*)\s*(?:文字|字)/);
    if (!m) continue;
    const chars = parseYen(m[1]);
    if (chars < 300 || chars > 300000) continue;
    return {
      chars, contractYen: terms.contract.yen, testYen: terms.test ? terms.test.yen : null,
      yenPerChar: Math.round((terms.contract.yen / chars) * 100) / 100,
      excerpt: excerpt(line),
    };
  }
  return null;
}

// ===== 創作系（小説・朗読シナリオ・娯楽系台本）。営業・教育・業務改善に関わる台本は対象にしない =====
const CREATIVE_TOPIC_RE = /(小説|朗読|スカッと|物語|ショートドラマ|ドラマ|漫画|エンタメ|娯楽|怪談|恋愛|創作|ラノベ)/;
const CREATIVE_WORK_RE = /(シナリオ|台本|脚本|小説|ストーリー|朗読)/;
const BUSINESS_CONTEXT_RE = /(営業|セールス|研修|教育|マニュアル|業務|社内|採用|商品紹介|サービス紹介|講座|解説|ホワイトペーパー|提案|eラーニング|説明動画)/;

function detectCreativeEntertainment(title, description) {
  const t = String(title || '');
  const head = `${t}\n${String(description || '').slice(0, 200)}`;
  const detected = CREATIVE_TOPIC_RE.test(head) && CREATIVE_WORK_RE.test(t) && !BUSINESS_CONTEXT_RE.test(t);
  return { detected, excerpt: detected ? excerpt(t) : null };
}

// ===== 資格・職業・属性・経験の限定（明確な応募資格の不一致） =====
// 「施工管理の経験が2年以上ある方に限る」「保育士さん募集」「専門家募集」のように、応募者の資格・職業・属性を
// 限定する明確な表現。ゆうきの確認済みの経歴領域（飲食・店舗運営・マネジメント・資料作成等）と重なる語を含む行は、
// 除外せず「要確認」にとどめる。
const QUALIFICATION_PATTERNS = [
  /\d+\s*年以上[^。\n]{0,20}(?:に限る|に限ります|限定|のみ|必須)/,
  /(?:保育士|看護師|医師|薬剤師|栄養士|教員|弁護士|税理士|社労士|施工管理|建築士|介護士|美容師)[^。\n]{0,15}(?:に限る|に限ります|限定|のみ|必須|経験者)/,
  /【[^】]{0,6}(?:専門家|有資格者|現役[^】]{1,8}|(?:保育士|看護師|医師|薬剤師|栄養士|介護士|美容師)(?:さん)?)[^】]{0,6}(?:募集|限定)[^】]{0,3}】/,
  /【[^】]{0,4}(?:女性|男性)[^】]{0,10}(?:さん|の方)?募集[^】]{0,3}】/,
];
// 補助金・助成金の申請業務（専門実務。evaluator.jsのSPECIALIZED_SCOPE_PATTERNSと同じ趣旨で、言い換え表記を補う）
QUALIFICATION_PATTERNS.push(/(?:補助金|助成金)[^。\n]{0,8}申請(?:の)?(?:サポート|代行|支援|業務|実務|書類)/);
const KNOWN_BACKGROUND = /(飲食|店舗|店長|マネージャー|マネジメント|プロジェクト|営業資料|提案|資料作成)/;

function detectQualificationMismatch(text) {
  const lines = toLines(text);
  for (const line of lines) {
    for (const re of QUALIFICATION_PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      return { detected: true, level: KNOWN_BACKGROUND.test(line) ? 'confirm' : 'mismatch', matched: m[0], excerpt: excerpt(line) };
    }
  }
  return { detected: false, level: null, matched: null, excerpt: null };
}

// ===== 必須の経験（応募条件の見出しの下に「〜の経験がある方」と明記されているもの） =====
// 提案資料・記事など、登録済みの手持ち資産でカバーできる種類（DELIVERABLE_TYPESのcoveredBy）が明記されている場合は
// 対象にしない。種類が特定できない／手持ち資産が無い種類の場合は、満たすかどうかの確認事項として検出する。
const REQ_EXP_HEADING = /(必須スキル|必須条件|必須要件|応募条件|応募資格|応募要件|重要視する点|求める人材|求めるスキル|求める経験|求める方)/;
const REQ_EXP_LINE = /(経験(?:が|の)?(?:ある|あり|お持ち|豊富)|経験者|実務経験)/;
const REQ_EXP_SOFT = /(歓迎|尚可|あれば|未経験|不問|問わず|なくても|優遇|あると)/;

const REQ_EXP_GENERIC = /(社会人経験|ビジネス経験|職種指定なし|PC操作)/;
// タイトルの「〇〇経験者募集」「【〇〇経験者】」は、経験者に限る募集（「経験者歓迎」は対象外）
const REQ_EXP_TITLE = /(?:【[^】]{0,20}経験者(?:募集)?[^】歓]{0,6}】|[^\s【】、。]{2,14}経験者募集)/;

function detectRequiredExperience(text) {
  const lines = toLines(text);
  const title = lines[0] || '';
  const tm = title.match(REQ_EXP_TITLE);
  if (tm && !/経験者(?:大)?歓迎|経験者優遇/.test(title) && !(matchDeliverableTypes(tm[0]).length > 0 && matchDeliverableTypes(tm[0]).every(t => t.coveredBy.length > 0))) {
    return { detected: true, excerpt: excerpt(tm[0]) };
  }
  for (let i = 0; i < lines.length; i++) {
    if (!REQ_EXP_HEADING.test(lines[i])) continue;
    for (let j = i; j < Math.min(lines.length, i + 7); j++) {
      const line = lines[j];
      if (!REQ_EXP_LINE.test(line) || REQ_EXP_SOFT.test(line) || REQ_EXP_GENERIC.test(line)) continue;
      const types = matchDeliverableTypes(line);
      if (types.length > 0 && types.every(t => t.coveredBy.length > 0)) continue; // 手持ち資産でカバーできる種類
      return { detected: true, excerpt: excerpt(line) };
    }
  }
  return { detected: false, excerpt: null };
}

// ===== 必須提出物（制作実績・ポートフォリオ）と、手持ち資産との突合 =====
// coveredBy：その種類をカバーする「登録済みの手持ち資産名」（knowledge/yuki_portfolio.js・Application Packetの
// 資産名と同じ表記）。空配列＝提示できる同種の作品が無い。action：不足を補う具体的な行動。
const DELIVERABLE_TYPES = [
  {
    id: 'price_menu', label: 'メニュー表・価格表・カタログ',
    patterns: ['メニュー表', '価格表', '料金表', '価格リスト', '商品カタログ', 'カタログ'],
    coveredBy: [],
    action: 'メニュー表または価格表のサンプルを1点自主制作し、画像制作ポートフォリオ（/design）に追加してから応募する',
  },
  {
    id: 'sales_copy', label: 'LP・ステップメール・セールスレター',
    patterns: ['LP', 'ランディングページ', 'セールスレター', 'ステップメール', 'メルマガ', 'セールスライティング', 'セールスコピー'],
    coveredBy: [],
    action: 'LP原稿またはステップメールのサンプルを1本自主制作し、ライティングポートフォリオ（/writing）に追加してから応募する',
  },
  {
    id: 'scenario', label: 'シナリオ・台本（朗読・動画）',
    patterns: ['シナリオ', '台本', '脚本', '朗読'],
    coveredBy: [],
    action: 'シナリオ（台本）のサンプルを1本自主制作し、ライティングポートフォリオ（/writing）に追加してから応募する',
  },
  {
    id: 'manual', label: 'マニュアル・手順書',
    patterns: ['マニュアル', '手順書'],
    coveredBy: [],
    action: 'マニュアルのサンプルを1点自主制作し、資料制作ポートフォリオ（/improvement）に追加してから応募する',
  },
  {
    id: 'article', label: '記事・ライティング',
    patterns: ['記事', 'ブログ', 'コラム', 'ライティング', 'SEO'],
    coveredBy: ['AIライティング5記事'],
    action: null,
  },
  {
    id: 'proposal', label: '提案書・営業資料・スライド',
    patterns: ['提案書', '提案資料', '企画書', '営業資料', 'スライド', 'PowerPoint', 'パワーポイント'],
    coveredBy: ['飲食事業改善 提案資料'],
    action: null,
  },
  {
    id: 'image', label: 'バナー・画像制作',
    patterns: ['バナー', 'サムネ', 'Instagram', 'インスタ', '画像制作', 'イラスト'],
    coveredBy: ['AI画像5作品'],
    action: null,
  },
];

function matchDeliverableTypes(text) {
  return DELIVERABLE_TYPES.filter(t => t.patterns.some(p => String(text).includes(p)));
}

const SUBMISSION_NOUN = /(ポートフォリオ|制作実績|作品|サンプル|実績)/;
const SUBMISSION_VERB = /(添付|提出|提示|ご提示|ご提出|送付|URL|拝見|お見せ)/;
const OPTIONAL_MARK = /(あれば|あると|任意|歓迎|できれば|可能であれば|お持ちの場合|お持ちであれば)/;
const REQUIRED_CONTEXT = /(必須|必ず|応募条件|応募資格|応募時|応募の際|選考)/;

function detectRequiredSubmission(text) {
  const lines = toLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SUBMISSION_NOUN.test(line) || !SUBMISSION_VERB.test(line) || OPTIONAL_MARK.test(line)) continue;
    const around = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
    if (!(REQUIRED_CONTEXT.test(line) || REQUIRED_CONTEXT.test(around))) continue;
    // 種類の判定は、提出を求める行とその前後（実績の種類が前の行に書かれる形式が多い）で行う
    const window = lines.slice(Math.max(0, i - 2), i + 2).join('\n');
    const types = matchDeliverableTypes(window);
    const specific = types.filter(t => ['price_menu', 'sales_copy', 'manual', 'scenario'].includes(t.id));
    // 提出を求める行の周辺に種類が無ければ、案件タイトルが示す種類で補う
    const titleTypes = matchDeliverableTypes(lines[0] || '').filter(t => ['price_menu', 'sales_copy', 'manual', 'scenario'].includes(t.id));
    const target = specific.length > 0 ? specific : (titleTypes.length > 0 ? titleTypes : types);
    const uncovered = target.filter(t => t.coveredBy.length === 0);
    return {
      required: true,
      excerpt: excerpt(line),
      types: target.map(t => ({ id: t.id, label: t.label, covered: t.coveredBy.length > 0 })),
      uncovered: uncovered.map(t => ({ id: t.id, label: t.label, action: t.action })),
    };
  }
  return { required: false, excerpt: null, types: [], uncovered: [] };
}

// 案件の全文（タイトル＋本文）から、選定に使う重要事項をまとめて検出する
function detectSelectionSignals(title, description, price = null) {
  const text = `${title || ''}\n${description || ''}`;
  const workload = detectWorkload(text);
  const priceTerms = detectPriceTerms(text);
  return {
    age: detectAgeCondition(text),
    specialApply: detectSpecialApplyMethod(text),
    workload,
    // 旧API互換（具体的な拘束があるか）
    workConstraint: { detected: !['none', 'light'].includes(workload.level), level: workload.level, excerpts: workload.excerpts },
    language: detectLanguageRequirement(text),
    priceDetail: classifyDetailPrice(price),
    priceTerms,
    workloadPrice: detectWorkloadPrice(text, priceTerms),
    creative: detectCreativeEntertainment(title, description),
    qualification: detectQualificationMismatch(text),
    requiredExperience: detectRequiredExperience(text),
    requiredSubmission: detectRequiredSubmission(text),
  };
}

module.exports = {
  DELIVERABLE_TYPES,
  detectAgeCondition,
  detectSpecialApplyMethod,
  AVAILABILITY,
  detectWorkload,
  detectWorkConstraint,
  detectLanguageRequirement,
  detectPriceTerms,
  classifyDetailPrice,
  formatTermYen,
  detectWorkloadPrice,
  detectCreativeEntertainment,
  detectQualificationMismatch,
  detectRequiredExperience,
  detectRequiredSubmission,
  detectSelectionSignals,
};
