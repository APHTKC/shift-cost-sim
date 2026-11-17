const MINUTES_PER_DAY = 1440;
export const CYCLE_DAYS = 28;
export const dayLabels = {
  unset: '請選擇', work: '工作日', regular: '例假', rest: '休息日', empty: '空班日'
};

export function eligible({ industry, union, consent }) {
  const designated = ['tourist', 'hotel', 'food'].includes(industry);
  return designated && ((union === 'yes' && consent === 'union') || (union === 'no' && consent === 'meeting'));
}

export function cycleDates(startDate) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? Date.parse(startDate + 'T00:00:00Z') : NaN;
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== startDate) {
    return Array(CYCLE_DAYS).fill('');
  }
  return Array.from({ length: CYCLE_DAYS }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}

export function parseIntervals(value) {
  if (!value.trim()) return [];
  const intervals = [];
  let offset = 0;
  let priorClock = -1;
  for (const part of value.trim().split(/[,，、]/)) {
    const match = /^(\d{1,2}):([0-5]\d)\s*[-–—~～]\s*(\d{1,2}):([0-5]\d)$/.exec(part.trim());
    if (!match) return null;
    const [, h1, m1, h2, m2] = match.map(Number);
    if (h1 > 23 || h2 > 24 || (h2 === 24 && m2)) return null;
    const startClock = h1 * 60 + m1;
    const endClock = h2 * 60 + m2;
    if (startClock === endClock) return null;
    if (startClock < priorClock) offset += MINUTES_PER_DAY;
    const start = startClock + offset;
    const end = endClock + offset + (endClock < startClock ? MINUTES_PER_DAY : 0);
    const previous = intervals.at(-1);
    if ((!previous && start >= MINUTES_PER_DAY)
        || (previous && start < previous.end)
        || end >= 2 * MINUTES_PER_DAY) return null;
    intervals.push({ start, end });
    priorClock = startClock;
  }
  return intervals.at(-1).end - intervals[0].start <= MINUTES_PER_DAY ? intervals : null;
}

export function evaluateRoster(settings, entries) {
  const dates = cycleDates(settings.startDate);
  const issues = [];
  const add = (text, day = null, level = 'error') => issues.push({ text, day, level });
  if (!eligible(settings)) add('四週變形工時的行業別或同意程序尚未確認。');
  if (!dates[0]) add('請填寫雙方議定的工時週期起日。');
  let totalNormal = 0;
  let lastShiftEnd = null;
  const monthOvertime = new Map();

  const rows = dates.map((date, day) => {
    const entry = entries[day] ?? {};
    const type = Object.hasOwn(dayLabels, entry.type) ? entry.type : 'unset';
    const intervals = parseIntervals(String(entry.intervals ?? ''));
    const normalHours = entry.normal === '' || entry.normal == null ? null : Number(entry.normal);
    const validNormal = normalHours !== null && Number.isFinite(normalHours) && normalHours >= 0;
    const normal = validNormal ? Math.round(normalHours * 60) : null;
    const work = intervals?.reduce((minutes, span) => minutes + span.end - span.start, 0) ?? null;
    const overtime = work !== null && normal !== null && normal <= work ? work - normal : null;
    if (type === 'unset') add('請選擇日別。', day);
    if (!intervals) add('工作區間格式錯誤或時段重疊。', day);
    if (type === 'work' && work === 0) add('工作日請填寫工作區間。', day);
    if ((type === 'regular' || type === 'empty') && work > 0) add('例假或空班日有工作，請人工確認日別與出勤依據。', day);
    if (type !== 'work' && normal > 0) add('此日別的正常工時應填 0。', day);
    if (normal === null || (work !== null && normal > work)) add('正常工時請填 0 至實際工時之間。', day);
    if (normal !== null) {
      totalNormal += normal;
      if (normal > 600) add('正常工時超過每日 10 小時。', day);
      if (normal === 600 && overtime > 120) add('正常工時達 10 小時，延長工時超過 2 小時。', day);
    }
    if (work > 720) add('實際工時超過每日 12 小時。', day);
    if (type === 'rest' && work > 0) add('休息日有出勤，應核對延長工時、出勤程序與加給。', day, 'review');

    if (intervals?.length) {
      let run = 0;
      let longest = 0;
      let previousEnd = null;
      for (const { start, end } of intervals) {
        if (previousEnd !== null && start - previousEnd >= 30) run = 0;
        run += end - start;
        longest = Math.max(run, longest);
        previousEnd = end;
      }
      if (longest > 240) add('連續工作超過 4 小時，未見至少 30 分鐘休息，請核對是否有適用例外。', day);
      const start = day * MINUTES_PER_DAY + intervals[0].start;
      const end = day * MINUTES_PER_DAY + intervals.at(-1).end;
      if (lastShiftEnd !== null && start < lastShiftEnd) {
        add('班次與前一班重疊。', day);
      } else if (lastShiftEnd !== null && start - lastShiftEnd < 660) {
        add('與前一班間距未滿 11 小時，請核對是否為輪班換班及是否有適用例外。', day, 'review');
      }
      lastShiftEnd = Math.max(lastShiftEnd ?? 0, end);
    }
    if (date && overtime > 0) {
      // At a month boundary the start-date bucket cannot establish a legal calendar-month total.
      const month = date.slice(0, 7);
      monthOvertime.set(month, (monthOvertime.get(month) ?? 0) + overtime);
    }
    return { date, type, intervals: entry.intervals ?? '', normal, work, overtime };
  });

  if (totalNormal > 9600) add('四週正常工時合計超過 160 小時。');
  const regularCount = (first, end) => rows.slice(first, end).filter(row => row.type === 'regular' && row.work === 0).length;
  const firstRegular = regularCount(0, 14);
  const secondRegular = regularCount(14, 28);
  const restDays = rows.filter(row => row.type === 'rest').length + firstRegular + secondRegular;
  if (firstRegular < 2) add('前兩週例假少於 2 日。');
  if (secondRegular < 2) add('後兩週例假少於 2 日。');
  if (restDays < 8) add('四週例假與休息日合計少於 8 日。');
  for (const [month, minutes] of monthOvertime) {
    if (minutes > 46 * 60) add(month + '：此班表已列超過 46 小時延長工時，請核對起班日歸屬、完整月份、同意與備查。', null, 'review');
  }
  return { rows, issues, totalNormal, firstRegular, secondRegular, restDays };
}
