import { CYCLE_DAYS, cycleDates, dayLabels, eligible, evaluateRoster, parseIntervals } from './working-time.mjs';

const key = 'restaurant-labor-roster-v1';
const $ = id => document.getElementById(id);
const settingsFields = ['industry', 'union', 'consent', 'startDate'];
const blank = () => Array.from({ length: CYCLE_DAYS }, () => ({ type: 'unset', intervals: '', normal: '' }));
let entries = blank();
let latest = null;
try {
  const stored = JSON.parse(localStorage.getItem(key));
  if (Array.isArray(stored?.entries) && stored.entries.length === CYCLE_DAYS) entries = stored.entries;
  for (const id of settingsFields) $(id).value = stored?.settings?.[id] ?? '';
} catch {}

const settings = () => Object.fromEntries(settingsFields.map(id => [id, $(id).value]));
const time = minutes => minutes === null ? '—' : (minutes / 60).toFixed(2).replace(/\.?0+$/, '');
const t = value => window.siteTranslate?.(value) ?? value;
const rowNodes = [];

function persist() {
  try { localStorage.setItem(key, JSON.stringify({ settings: settings(), entries })); } catch {}
}

function updateEligibility() {
  const fields = settings();
  const ready = eligible(fields);
  $('eligibilityStatus').dataset.clear = String(ready);
  $('eligibilityStatus').textContent = ready
    ? '已依輸入確認指定行業與相符同意程序。請接續檢查班表。'
    : '尚未確認適用條件：請選擇指定行業及與有無工會相符的同意程序。';
  const dates = cycleDates(fields.startDate);
  rowNodes.forEach((node, index) => { node.date.textContent = dates[index] || '—'; });
}

function setDirty() {
  latest = null;
  $('review').hidden = true;
  $('exportRoster').disabled = true;
  rowNodes.forEach(({ row }) => { delete row.dataset.issue; });
}

function recalculateDay(index) {
  const entry = entries[index];
  const totals = parseIntervals(entry.intervals);
  const work = totals?.reduce((sum, span) => sum + span.end - span.start, 0) ?? null;
  const normal = entry.normal === '' ? null : Math.round(Number(entry.normal) * 60);
  rowNodes[index].work.textContent = time(work);
  rowNodes[index].overtime.textContent = time(work !== null && normal !== null && normal >= 0 && work >= normal ? work - normal : null);
}

function makeElement(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

function renderRows() {
  $('rosterRows').replaceChildren();
  rowNodes.length = 0;
  entries.forEach((entry, index) => {
    const row = makeElement('tr');
    if (index && index % 7 === 0) row.className = 'week-start';
    const date = makeElement('td', '—');
    const type = makeElement('select');
    const intervals = makeElement('input');
    const normal = makeElement('input');
    for (const [value, label] of Object.entries(dayLabels)) {
      const option = makeElement('option', label);
      option.value = value;
      type.append(option);
    }
    type.value = entry.type;
    intervals.type = 'text';
    intervals.maxLength = 140;
    intervals.placeholder = '09:00-13:00, 14:00-18:00';
    intervals.value = entry.intervals;
    normal.type = 'number';
    normal.min = '0';
    normal.max = '24';
    normal.step = 'any';
    normal.value = entry.normal;
    const work = makeElement('td');
    const overtime = makeElement('td');
    for (const [input, label] of [[type, '日別'], [intervals, '工作區間'], [normal, '正常工時']]) {
      input.setAttribute('aria-label', '第 ' + (index + 1) + ' 日｜' + label);
      const update = () => {
        if (input === type && input.value !== 'work' && input.value !== 'unset') normal.value = '0';
        entries[index] = { type: type.value, intervals: intervals.value.trim(), normal: normal.value };
        recalculateDay(index);
        setDirty();
        persist();
      };
      input.addEventListener(input === type ? 'change' : 'input', update);
    }
    const cells = [type, intervals, normal].map(input => {
      const cell = makeElement('td');
      cell.append(input);
      return cell;
    });
    row.append(makeElement('td', index + 1), date, ...cells, work, overtime);
    $('rosterRows').append(row);
    rowNodes.push({ row, date, work, overtime });
    recalculateDay(index);
  });
  updateEligibility();
  setDirty();
}

function review() {
  latest = evaluateRoster(settings(), entries);
  const { issues, totalNormal, firstRegular, secondRegular, restDays } = latest;
  const flaggedDays = new Set(issues.map(issue => issue.day));
  rowNodes.forEach(({ row }, index) => { row.dataset.issue = String(flaggedDays.has(index)); });
  $('totals').replaceChildren(...[
    '四週正常工時 ' + time(totalNormal) + ' 小時',
    '前兩週例假 ' + firstRegular + ' 日',
    '後兩週例假 ' + secondRegular + ' 日',
    '例假及休息日 ' + restDays + ' 日'
  ].map(label => makeElement('span', label)));
  $('summaryStatus').dataset.clear = String(issues.length === 0);
  $('summaryStatus').textContent = issues.length === 0
    ? '本班表通過本頁列出的初步檢查。請用完整出勤與薪資紀錄覆核。'
    : '有 ' + issues.length + ' 項需要修正或人工確認。';
  $('issues').replaceChildren(...issues.map(({ day, text }) => {
    const item = makeElement('li');
    if (day !== null) item.append(makeElement('strong', '第 ' + (day + 1) + ' 日｜'));
    item.append(makeElement('span', text));
    return item;
  }));
  $('review').hidden = false;
  $('exportRoster').disabled = false;
  persist();
}

function sample(hours) {
  const eight = ['work','work','work','work','work','regular','rest'];
  const ten = ['regular','regular','empty','work','work','work','work','work','work','work','work','rest','rest','empty'];
  const pattern = hours === 8 ? eight : ten;
  entries = blank().map((_, index) => {
    const type = pattern[index % pattern.length];
    const intervals = hours === 8 ? '09:00-13:00, 14:00-18:00' : '09:00-13:00, 13:30-17:30, 18:00-20:00';
    return { type, normal: type === 'work' ? String(hours) : '0', intervals: type === 'work' ? intervals : '' };
  });
  renderRows();
  persist();
}

function exportCsv() {
  if (!latest) return;
  const fields = settings();
  const selectText = field => $(field).selectedOptions[0]?.textContent ?? '';
  const rows = [
    ['法規與排班檢核'],
    ['雇主行業別', selectText('industry'), '事業單位有工會', selectText('union'), '四週工時制度的同意紀錄', selectText('consent'), '正常工時週期起日', fields.startDate],
    ['日次','日期','日別','工作區間（24 小時制）','正常工時','實際工時','延長工時'],
    ...latest.rows.map((row,index) => [index + 1, row.date, dayLabels[row.type], row.intervals, time(row.normal), time(row.work), time(row.overtime)]),
    ['檢核結果', $('summaryStatus').textContent],
    ...latest.issues.map(issue => [issue.day === null ? '' : issue.day + 1, issue.text]),
    ['勞動基準法官方英文版','https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=N0030001'],
    ['全國法規資料庫｜勞動基準法中文全文','https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001']
  ];
  const escape = value => '"' + String(t(value)).replace(/"/g, '""') + '"';
  const output = rows.map(row => row.map(escape).join(',')).join('\r\n');
  const objectUrl = URL.createObjectURL(new Blob(['\ufeff', output], { type: 'text/csv;charset=utf-8' }));
  const anchor = makeElement('a');
  anchor.href = objectUrl;
  anchor.download = t('四週變形工時班表檢核.csv');
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

for (const id of settingsFields) $(id).addEventListener('change', () => { updateEligibility(); setDirty(); persist(); });
$('sample8').addEventListener('click', () => sample(8));
$('sample10').addEventListener('click', () => sample(10));
$('clearRoster').addEventListener('click', () => {
  if (!confirm(t('確定清空班表？'))) return;
  entries = blank();
  renderRows();
  persist();
});
$('checkRoster').addEventListener('click', review);
$('exportRoster').addEventListener('click', exportCsv);
$('printRoster').addEventListener('click', () => { review(); window.print(); });
renderRows();
