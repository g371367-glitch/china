// Календарь сроков: разворот правил из data/calendar.json в ближайшие даты. Без DOM.
//
// Событие: {country, what, who, rule, when?, important?}; rule — один из:
//   {type:'monthly', day}                    — каждый месяц до day-го (31 в коротком месяце → последний день);
//   {type:'quarterly', dates:['MM-DD', …]}   — несколько дат в году;
//   {type:'yearly', date:'MM-DD'};
//   {type:'once', date:'YYYY-MM-DD'};
//   {type:'afterRegistration', months}       — от settings.registrationDate ('YYYY-MM-DD').
//
// upcoming(events, today, settings, count) →
//   [{date:'YYYY-MM-DD'|null, country, what, who, when?, important?, soon, daysLeft:number|null, needsRegistrationDate}]
// Каждое событие даёт одну — ближайшую — дату (сегодня включительно), прошедшие не попадают.
// Список отсортирован по дате и обрезан до count; если дата регистрации не вписана, событие
// afterRegistration идёт первым сверх count с date:null и needsRegistrationDate:true.
// daysLeft — дней от today до date (0 — сегодня; null у заглушки); soon — daysLeft ≤ SOON_DAYS.

export const SOON_DAYS = 30;

const DAY = 86400000;

/** 'YYYY-MM-DD' | Date → число дней UTC (для сравнения и разницы). */
function toDay(d) {
  if (d instanceof Date) return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY;
}

const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();   // m — 0..11

/** День из (год, месяц 0..11 с переполнением, число) с прижатием к концу месяца. */
function ymd(y, m, d) {
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return Date.UTC(y, m, Math.min(d, daysIn(y, m))) / DAY;
}

function iso(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

function mmdd(s) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? [+m[1] - 1, +m[2]] : null;
}

/** Ближайшая дата правила не раньше t (день UTC); null — нет такой. */
function nextDate(rule, t, settings) {
  const now = new Date(t * DAY);
  const Y = now.getUTCFullYear();
  const M = now.getUTCMonth();
  const firstFrom = (cands) => cands.filter((x) => x != null && x >= t).sort((a, b) => a - b)[0] ?? null;
  switch (rule && rule.type) {
    case 'monthly':
      return firstFrom([ymd(Y, M, rule.day), ymd(Y, M + 1, rule.day)]);
    case 'quarterly':
    case 'yearly': {
      const list = (rule.type === 'yearly' ? [rule.date] : rule.dates || []).map(mmdd).filter(Boolean);
      return firstFrom(list.flatMap(([m, d]) => [ymd(Y, m, d), ymd(Y + 1, m, d)]));
    }
    case 'once':
      return firstFrom([toDay(rule.date)]);
    case 'afterRegistration': {
      const reg = toDay(settings && settings.registrationDate);
      if (reg == null) return undefined;           // нужна дата регистрации
      const r = new Date(reg * DAY);
      return firstFrom([ymd(r.getUTCFullYear(), r.getUTCMonth() + (rule.months || 0), r.getUTCDate())]);
    }
    default:
      return null;
  }
}

export function upcoming(events, today, settings = {}, count = 8) {
  const t = toDay(today instanceof Date ? today : String(today).slice(0, 10));
  const placeholders = [];
  const dated = [];
  for (const e of events || []) {
    const { rule, ...rest } = e;
    const d = nextDate(rule, t, settings || {});
    if (d === undefined) placeholders.push({ ...rest, date: null, soon: false, daysLeft: null, needsRegistrationDate: true });
    else if (d != null) dated.push({ ...rest, date: iso(d), soon: d - t <= SOON_DAYS, daysLeft: d - t, needsRegistrationDate: false, _d: d });
  }
  dated.sort((a, b) => a._d - b._d);
  return [...placeholders, ...dated.slice(0, count).map(({ _d, ...x }) => x)];
}
