const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  totalBetween,
  summarizePractice,
  previousPeriodTotals,
  dailyAverage
} = require('../piano-summary.js');

const minute = 60 * 1000;
const localTime = (year, month, day, hour = 0, minutes = 0) =>
  new Date(year, month - 1, day, hour, minutes).getTime();

test('日・週・月の開始をローカル時刻で求める', () => {
  const wednesday = new Date(2026, 7, 5, 18, 30);
  assert.equal(startOfDay(wednesday), localTime(2026, 8, 5));
  assert.equal(startOfWeek(wednesday), localTime(2026, 8, 3));
  assert.equal(startOfMonth(wednesday), localTime(2026, 8, 1));
});

test('日曜日も月曜日始まりの同じ週に含める', () => {
  assert.equal(
    startOfWeek(new Date(2026, 7, 9, 12)),
    localTime(2026, 8, 3)
  );
});

test('日をまたぐセッションを今日の開始位置で分割する', () => {
  const now = localTime(2026, 8, 5, 12);
  const sessions = [{
    startedAt: localTime(2026, 8, 4, 23, 30),
    endedAt: localTime(2026, 8, 5, 0, 30)
  }];
  const summary = summarizePractice(sessions, { now });
  assert.equal(summary.today, 30 * minute);
  assert.equal(summary.week, 60 * minute);
  assert.equal(summary.month, 60 * minute);
  assert.equal(summary.all, 60 * minute);
});

test('日・週・月・累計に該当する保存済みセッションを集計する', () => {
  const now = localTime(2026, 8, 5, 20);
  const sessions = [
    { startedAt: localTime(2026, 8, 5, 8), endedAt: localTime(2026, 8, 5, 8, 30) },
    { startedAt: localTime(2026, 8, 3, 9), endedAt: localTime(2026, 8, 3, 10) },
    { startedAt: localTime(2026, 8, 1, 9), endedAt: localTime(2026, 8, 1, 9, 45) },
    { startedAt: localTime(2026, 7, 31, 9), endedAt: localTime(2026, 7, 31, 9, 15) }
  ];
  assert.deepEqual(summarizePractice(sessions, { now }), {
    today: 30 * minute,
    week: 90 * minute,
    month: 135 * minute,
    all: 150 * minute
  });
});

test('計測中のセッションを現在時刻まで加算する', () => {
  const now = localTime(2026, 8, 5, 10);
  const activeStart = localTime(2026, 8, 5, 9, 20);
  assert.deepEqual(summarizePractice([], { activeStart, now }), {
    today: 40 * minute,
    week: 40 * minute,
    month: 40 * minute,
    all: 40 * minute
  });
});

test('月またぎで計測中の場合は各期間の境界から集計する', () => {
  const now = localTime(2026, 8, 1, 0, 20);
  const activeStart = localTime(2026, 7, 31, 23, 50);
  const summary = summarizePractice([], { activeStart, now });
  assert.equal(summary.today, 20 * minute);
  assert.equal(summary.month, 20 * minute);
  assert.equal(summary.all, 30 * minute);
});

test('最初の練習日から今日までの暦日数で一日平均を求める', () => {
  const now = localTime(2026, 8, 5, 20);
  const sessions = [
    { startedAt: localTime(2026, 8, 3, 9), endedAt: localTime(2026, 8, 3, 10) },
    { startedAt: localTime(2026, 8, 5, 9), endedAt: localTime(2026, 8, 5, 9, 30) }
  ];
  assert.equal(dailyAverage(sessions, { now }), 30 * minute);
  assert.equal(dailyAverage([], { now }), 0);
});

test('年の開始と指定期間内の練習時間を求める', () => {
  const now = localTime(2026, 8, 5, 12);
  const sessions = [
    { startedAt: localTime(2025, 12, 31, 23, 30), endedAt: localTime(2026, 1, 1, 0, 30) },
    { startedAt: localTime(2026, 8, 5, 8), endedAt: localTime(2026, 8, 5, 9) }
  ];
  assert.equal(startOfYear(new Date(now)), localTime(2026, 1, 1));
  assert.equal(totalBetween(sessions, localTime(2026, 1, 1), localTime(2027, 1, 1)), 90 * minute);
  assert.equal(totalBetween([], localTime(2026, 8, 5), localTime(2026, 8, 6), localTime(2026, 8, 5, 11), now), 60 * minute);
});

test('昨日・先週・先月・昨年の練習時間を期間境界で集計する', () => {
  const now = localTime(2026, 8, 5, 12);
  const sessions = [
    { startedAt: localTime(2026, 8, 4, 9), endedAt: localTime(2026, 8, 4, 9, 30) },
    { startedAt: localTime(2026, 7, 28, 9), endedAt: localTime(2026, 7, 28, 10) },
    { startedAt: localTime(2026, 7, 1, 9), endedAt: localTime(2026, 7, 1, 9, 45) },
    { startedAt: localTime(2025, 12, 31, 23), endedAt: localTime(2026, 1, 1, 1) }
  ];
  assert.deepEqual(previousPeriodTotals(sessions, { now }), {
    yesterday: 30 * minute,
    lastWeek: 60 * minute,
    lastMonth: 105 * minute,
    lastYear: 60 * minute
  });
});
