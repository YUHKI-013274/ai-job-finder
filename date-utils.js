// 応募期限の正規化・判定ユーティリティ。
//
// CrowdWorksの実際の求人カードを確認したところ、応募期限は主に2つの形で表示される。
//   1. 相対表示「あと3日（8月5日まで）」（募集中の案件。年は含まれない）
//   2. 「募集終了」という文字列そのもの（期限切れの案件。上記の相対表示の代わりに表示される）
// 案件詳細ページでは「応募期限　2026年07月28日」のような絶対日付表示もあるが、
// scraper.jsは検索結果一覧ページ（カード）のみを取得するため、上記1・2が主な情報源となる。
//
// タイムゾーンの注意：日付の計算はすべて日本時間（Asia/Tokyo）基準で行う。
// ブラウザ（page.evaluate内）はCI環境ではUTC等になり得るため、日付計算はNode側（本ファイル）でのみ行い、
// ブラウザ側では「あと何日か」「募集終了の文字列があるか」等の生の文字列情報だけを抽出する。

// 日本時間での「今日」をYYYY-MM-DD形式で返す
function todayJST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

// YYYY-MM-DD文字列に日数を加算し、YYYY-MM-DD形式で返す（日本時間基準）
function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // UTC基準で計算することで、ローカルタイムゾーンによるズレを避ける（日付のみの計算のため時刻は使わない）
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 「2026年07月28日」「2026年7月28日」「2026/07/28」「2026-07-28」の4表記に対応した日付正規化。
// 解析できない場合はnullを返す（存在しない日付を捏造しない）。
function normalizeDateString(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  let m = str.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/);
  if (!m) m = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;

  const [, y, mo, d] = m;
  const year = parseInt(y, 10);
  const month = parseInt(mo, 10);
  const day = parseInt(d, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 年を含まない「M月D日」表記を、基準日（todayStr）から見て直近未来になるよう年を推定して正規化する。
// （応募期限は基準日より過去であることは通常ないため、月が基準日より小さい場合は翌年と推定する）
function normalizeMonthDayNearFuture(month, day, todayStr) {
  const [ty] = todayStr.split('-').map(Number);
  const [, tm] = todayStr.split('-').map(Number);
  let year = ty;
  // 基準月より大幅に前の月（=すでに過ぎた月）なら翌年の日付とみなす
  if (month < tm) year = ty + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 求人カードから抽出した生の情報（ブラウザ側で抽出済み）から、応募期限と状態を判定する。
 * @param {{ daysLeft: number|null, expiredMarker: boolean, monthDayText: string|null }} raw
 * @param {string} todayStr - 判定基準日（YYYY-MM-DD、日本時間）
 * @returns {{ deadline: string|null, deadlineStatus: 'open'|'expired'|'unknown' }}
 */
function resolveDeadline(raw, todayStr = todayJST()) {
  if (raw.expiredMarker && raw.daysLeft === null) {
    return { deadline: null, deadlineStatus: 'expired' };
  }
  if (raw.daysLeft !== null && !Number.isNaN(raw.daysLeft)) {
    const deadline = addDaysToDateString(todayStr, raw.daysLeft);
    const deadlineStatus = raw.daysLeft < 0 ? 'expired' : 'open';
    return { deadline, deadlineStatus };
  }
  if (raw.monthDayText) {
    const m = raw.monthDayText.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const deadline = normalizeMonthDayNearFuture(parseInt(m[1], 10), parseInt(m[2], 10), todayStr);
      const deadlineStatus = deadline < todayStr ? 'expired' : 'open';
      return { deadline, deadlineStatus };
    }
  }
  return { deadline: null, deadlineStatus: 'unknown' };
}

module.exports = { todayJST, addDaysToDateString, normalizeDateString, normalizeMonthDayNearFuture, resolveDeadline };
