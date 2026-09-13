(function exposePianoSummary(global) {
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function startOfWeek(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const daysSinceMonday = start.getDay() === 0 ? 6 : start.getDay() - 1;
    start.setDate(start.getDate() - daysSinceMonday);
    return start.getTime();
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }

  function startOfYear(date) {
    return new Date(date.getFullYear(), 0, 1).getTime();
  }

  function previousPeriodTotals(sessions, { activeStart = null, now = Date.now() } = {}) {
    const date = new Date(now);
    const thisWeek = startOfWeek(date);
    const lastWeekDate = new Date(thisWeek);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const thisMonth = startOfMonth(date);
    const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
    return {
      yesterday: totalBetween(sessions, new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).getTime(), startOfDay(date), activeStart, now),
      lastWeek: totalBetween(sessions, lastWeekDate.getTime(), thisWeek, activeStart, now),
      lastMonth: totalBetween(sessions, previousMonth, thisMonth, activeStart, now),
      lastYear: totalBetween(sessions, new Date(date.getFullYear() - 1, 0, 1).getTime(), startOfYear(date), activeStart, now)
    };
  }

  function totalBetween(sessions, start, end, activeStart = null, now = Date.now()) {
    const saved = sessions.reduce((sum, session) => {
      return sum + Math.max(0, Math.min(session.endedAt, end) - Math.max(session.startedAt, start));
    }, 0);
    const active = activeStart
      ? Math.max(0, Math.min(now, end) - Math.max(activeStart, start))
      : 0;
    return saved + active;
  }

  function sumSince(sessions, threshold, activeStart, now) {
    let total = sessions.reduce((sum, session) => {
      if (session.endedAt <= threshold) return sum;
      return sum + session.endedAt - Math.max(session.startedAt, threshold);
    }, 0);
    if (activeStart && now > threshold) total += now - Math.max(activeStart, threshold);
    return Math.max(0, total);
  }

  function totalAll(sessions, activeStart, now) {
    const saved = sessions.reduce(
      (sum, session) => sum + session.endedAt - session.startedAt,
      0
    );
    return saved + (activeStart ? now - activeStart : 0);
  }

  function summarizePractice(sessions, { activeStart = null, now = Date.now() } = {}) {
    const date = new Date(now);
    return {
      today: sumSince(sessions, startOfDay(date), activeStart, now),
      week: sumSince(sessions, startOfWeek(date), activeStart, now),
      month: sumSince(sessions, startOfMonth(date), activeStart, now),
      all: totalAll(sessions, activeStart, now)
    };
  }

  function dailyAverage(sessions, { activeStart = null, now = Date.now() } = {}) {
    const starts = sessions.map(session => session.startedAt);
    if (activeStart) starts.push(activeStart);
    if (!starts.length) return 0;
    const first = new Date(Math.min(...starts));
    const current = new Date(now);
    const firstUtc = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
    const currentUtc = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
    const days = Math.max(1, Math.floor((currentUtc - firstUtc) / 86400000) + 1);
    return totalAll(sessions, activeStart, now) / days;
  }

  const api = { startOfDay, startOfWeek, startOfMonth, startOfYear, totalBetween, summarizePractice, previousPeriodTotals, dailyAverage };
  global.PianoSummary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
