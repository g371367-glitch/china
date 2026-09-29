// Тесты календаря сроков — только через upcoming(). Ожидаемые даты разобраны вручную по календарю.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcoming } from '../web/js/calendar.js';

const ev = (what, rule, extra = {}) => ({ country: 'CN', what, who: 'Вы', rule, ...extra });
const dates = (list) => Object.fromEntries(list.map((e) => [e.what, e.date]));

test('monthly / quarterly / yearly / once — ближайшая дата от сегодня', () => {
  const events = [
    ev('m', { type: 'monthly', day: 15 }),
    ev('q', { type: 'quarterly', dates: ['01-15', '04-15', '07-15', '10-15'] }),
    ev('y', { type: 'yearly', date: '05-31' }),
    ev('o', { type: 'once', date: '2027-12-31' }),
  ];
  const r = upcoming(events, '2026-09-29', {}, 10);
  assert.deepEqual(dates(r), { m: '2026-10-15', q: '2026-10-15', y: '2027-05-31', o: '2027-12-31' });
  assert.deepEqual(r.map((e) => e.date), ['2026-10-15', '2026-10-15', '2027-05-31', '2027-12-31'], 'по возрастанию даты');
  assert.equal(r[0].who, 'Вы');
  assert.equal(r[0].country, 'CN');
});

test('срок сегодня ещё показывается, вчерашний — уже нет; прошедший once скрыт', () => {
  const events = [
    ev('m', { type: 'monthly', day: 5 }),
    ev('y', { type: 'yearly', date: '09-30' }),
    ev('o', { type: 'once', date: '2026-01-01' }),
  ];
  assert.deepEqual(dates(upcoming(events, '2026-09-05', {}, 10)), { m: '2026-09-05', y: '2026-09-30' });
  assert.deepEqual(dates(upcoming(events, '2026-09-06', {}, 10)), { m: '2026-10-05', y: '2026-09-30' });
});

test('переход через конец года', () => {
  const events = [
    ev('m', { type: 'monthly', day: 5 }),
    ev('q', { type: 'quarterly', dates: ['01-15', '04-15', '07-15', '10-15'] }),
    ev('y', { type: 'yearly', date: '01-31' }),
  ];
  assert.deepEqual(dates(upcoming(events, '2026-12-20', {}, 10)), { m: '2027-01-05', q: '2027-01-15', y: '2027-01-31' });
});

test('monthly на 31-е в коротком месяце — последний день месяца', () => {
  const r = upcoming([ev('m', { type: 'monthly', day: 31 })], '2027-02-10', {}, 5);
  assert.equal(r[0].date, '2027-02-28');
});

test('soon: ровно 30 дней — подсвечено, 31 день — нет', () => {
  const events = [ev('a', { type: 'once', date: '2026-10-29' }), ev('b', { type: 'once', date: '2026-10-30' })];
  const r = upcoming(events, '2026-09-29', {}, 5);
  assert.deepEqual(r.map((e) => [e.what, e.soon]), [['a', true], ['b', false]]);
});

test('afterRegistration: без даты — заглушка needsRegistrationDate, с датой — +N месяцев', () => {
  const events = [ev('reg', { type: 'afterRegistration', months: 3 }), ev('y', { type: 'yearly', date: '12-31' })];
  const noDate = upcoming(events, '2026-09-29', {}, 5);
  const reg = noDate.find((e) => e.what === 'reg');
  assert.equal(reg.needsRegistrationDate, true);
  assert.equal(reg.date, null);
  assert.equal(noDate.find((e) => e.what === 'y').needsRegistrationDate, false);

  const withDate = upcoming(events, '2026-09-29', { registrationDate: '2026-08-31' }, 5);
  const r2 = withDate.find((e) => e.what === 'reg');
  assert.equal(r2.needsRegistrationDate, false);
  assert.equal(r2.date, '2026-11-30', '31 августа + 3 месяца → 30 ноября');
  assert.equal(r2.soon, false);

  const past = upcoming(events, '2026-09-29', { registrationDate: '2025-01-10' }, 5);
  assert.equal(past.find((e) => e.what === 'reg'), undefined, 'срок прошёл — не показывается');
});

test('count ограничивает датированные события, заглушка регистрации идёт сверх и первой', () => {
  const events = [ev('reg', { type: 'afterRegistration', months: 3 })];
  for (let d = 1; d <= 12; d++) events.push(ev('y' + d, { type: 'yearly', date: `${String(d).padStart(2, '0')}-10` }));
  const r = upcoming(events, '2026-09-29', {}, 8);
  assert.equal(r.length, 9);
  assert.equal(r[0].what, 'reg');
  assert.deepEqual(r.slice(1).map((e) => e.date), ['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10']);
});

test('today можно передать объектом Date', () => {
  const r = upcoming([ev('y', { type: 'yearly', date: '10-01' })], new Date(2026, 8, 29), {}, 5);
  assert.equal(r[0].date, '2026-10-01');
  assert.equal(r[0].soon, true);
});

test('data/calendar.json — ровно строки сводного календаря README.md, и каждое правило разворачивается', async () => {
  const { readFile } = await import('node:fs/promises');
  const root = new URL('../../', import.meta.url);
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const cal = JSON.parse(await readFile(new URL('data/calendar.json', root), 'utf8'));
  const section = readme.split('## Сводный календарь')[1].split(/\n#{1,2} |\n---/)[0];
  const clean = (s) => s.replace(/\*\*/g, '').trim();
  const rows = section.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l)).slice(1)
    .map((l) => l.split('|').slice(1, -1).map(clean));
  const FLAGS = { CN: '🇨🇳', RU: '🇷🇺', 'CN-RU': '🇨🇳→🇷🇺' };
  assert.deepEqual(
    cal.events.map((e) => [e.when, FLAGS[e.country], e.what, e.who]),
    rows,
  );
  const r = upcoming(cal.events, '2026-09-29', { registrationDate: '2026-09-01' }, 100);
  assert.equal(r.length, cal.events.length, 'у каждого события есть будущая дата');
});
