'use strict';

// iCal reader for Google, Outlook and any other secret calendar link.
// Covers: all-day and timed events, TZID, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT,
// UNTIL, BYDAY, BYMONTHDAY, BYMONTH), EXDATE, moved or cancelled occurrences (RECURRENCE-ID).
const DAY_MS = 86400000;
const PAST_DAYS = 62; // the month view can be paged back and forward
const FUTURE_DAYS = 200;
const MAX_ITERATIONS = 5000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MEETING_LINK = /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s"'<>\\]+/i;

// Outlook publishes Windows zone names.
const WINDOWS_ZONES = {
  'India Standard Time': 'Asia/Kolkata',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'Arabian Standard Time': 'Asia/Dubai',
  'AUS Eastern Standard Time': 'Australia/Sydney',
};

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  const params = {};
  for (const param of rawParams) {
    const eq = param.indexOf('=');
    if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function findValueColon(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) return i;
  }
  return -1;
}

const unescapeText = (value) => value
  .replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

function zoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
}

// Wall clock in a named zone -> UTC ms. Falls back to the PC's own zone for unknown names.
function wallToUtc(wall, tzid) {
  const { y, m, d, h, mi, s } = wall;
  const timeZone = tzid && (WINDOWS_ZONES[tzid] || tzid);
  const asUtc = Date.UTC(y, m, d, h, mi, s);
  try {
    if (!timeZone) throw new RangeError('no zone');
    const first = asUtc - zoneOffsetMs(asUtc, timeZone);
    return asUtc - zoneOffsetMs(first, timeZone);
  } catch {
    return new Date(y, m, d, h, mi, s).getTime();
  }
}

function parseDate(value, params = {}) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return null;
  const [, y, m, d, h = '0', mi = '0', s = '0', utc] = match;
  return {
    wall: { y: +y, m: +m - 1, d: +d, h: +h, mi: +mi, s: +s },
    allDay: params.VALUE === 'DATE' || match[4] === undefined,
    utc: Boolean(utc),
    tzid: params.TZID,
  };
}

function toMs(date) {
  if (date.allDay) return new Date(date.wall.y, date.wall.m, date.wall.d).getTime();
  const { y, m, d, h, mi, s } = date.wall;
  return date.utc ? Date.UTC(y, m, d, h, mi, s) : wallToUtc(date.wall, date.tzid);
}

function parseEvents(text) {
  const events = [];
  let current = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { current = { exdates: new Set() }; continue; }
    if (line === 'END:VEVENT') { if (current && current.start) events.push(current); current = null; continue; }
    if (!current) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID': current.uid = prop.value; break;
      case 'SUMMARY': current.title = unescapeText(prop.value); break;
      case 'LOCATION': current.location = unescapeText(prop.value); break;
      case 'DESCRIPTION': current.description = unescapeText(prop.value); break;
      case 'URL': case 'X-GOOGLE-CONFERENCE': current.meeting = prop.value; break;
      case 'STATUS': current.cancelled = prop.value.toUpperCase() === 'CANCELLED'; break;
      case 'DTSTART': current.start = parseDate(prop.value, prop.params); break;
      case 'DTEND': current.end = parseDate(prop.value, prop.params); break;
      case 'RRULE': current.rrule = parseRule(prop.value); break;
      case 'RECURRENCE-ID': current.recurrenceId = parseDate(prop.value, prop.params); break;
      case 'EXDATE':
        for (const value of prop.value.split(',')) {
          const date = parseDate(value, prop.params);
          if (date) current.exdates.add(toMs(date));
        }
        break;
      default:
    }
  }
  return events;
}

function parseRule(value) {
  const rule = {};
  for (const part of value.split(';')) {
    const [key, val] = part.split('=');
    rule[key.toUpperCase()] = val;
  }
  return {
    freq: rule.FREQ,
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: rule.COUNT ? Number(rule.COUNT) : null,
    until: rule.UNTIL ? parseDate(rule.UNTIL) : null,
    byDay: rule.BYDAY ? rule.BYDAY.split(',').map((item) => {
      const match = item.match(/^([+-]?\d+)?([A-Z]{2})$/);
      return { nth: match[1] ? Number(match[1]) : 0, day: WEEKDAYS.indexOf(match[2]) };
    }) : null,
    byMonthDay: rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null,
    byMonth: rule.BYMONTH ? rule.BYMONTH.split(',').map((month) => Number(month) - 1) : null,
  };
}

function joinLink(event) {
  const haystack = [event.meeting, event.location, event.description].filter(Boolean).join(' ');
  const match = haystack.match(MEETING_LINK);
  return match ? match[0] : '';
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const weekday = (y, m, d) => new Date(Date.UTC(y, m, d)).getUTCDay();

function nthWeekdays(y, m, { nth, day }) {
  const days = [];
  for (let d = 1; d <= daysInMonth(y, m); d += 1) if (weekday(y, m, d) === day) days.push(d);
  if (nth === 0) return days;
  const picked = nth > 0 ? days[nth - 1] : days[days.length + nth];
  return picked ? [picked] : [];
}

function monthDays(y, m, rule, startDay) {
  if (rule.byDay) return rule.byDay.flatMap((item) => nthWeekdays(y, m, item)).sort((a, b) => a - b);
  const wanted = rule.byMonthDay || [startDay];
  const size = daysInMonth(y, m);
  return wanted.map((day) => (day < 0 ? size + day + 1 : day)).filter((day) => day >= 1 && day <= size)
    .sort((a, b) => a - b);
}

// Dates of each period of the rule, as {y, m, d} in the event's own wall clock.
function* ruleDates(start, rule) {
  const { y, m, d } = start.wall;
  const base = Date.UTC(y, m, d);
  const fromUtc = (ms) => {
    const date = new Date(ms);
    return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() };
  };

  for (let period = 0; period < MAX_ITERATIONS; period += 1) {
    if (rule.freq === 'DAILY') {
      yield fromUtc(base + period * rule.interval * DAY_MS);
    } else if (rule.freq === 'WEEKLY') {
      const weekStart = base - weekday(y, m, d) * DAY_MS + period * rule.interval * 7 * DAY_MS;
      const days = rule.byDay ? rule.byDay.map((item) => item.day).sort((a, b) => a - b) : [weekday(y, m, d)];
      for (const day of days) yield fromUtc(weekStart + day * DAY_MS);
    } else if (rule.freq === 'MONTHLY') {
      const total = m + period * rule.interval;
      const yy = y + Math.floor(total / 12);
      const mm = ((total % 12) + 12) % 12;
      for (const day of monthDays(yy, mm, rule, d)) yield { y: yy, m: mm, d: day };
    } else if (rule.freq === 'YEARLY') {
      const yy = y + period * rule.interval;
      for (const mm of rule.byMonth || [m]) {
        for (const day of monthDays(yy, mm, rule, d)) yield { y: yy, m: mm, d: day };
      }
    } else {
      return;
    }
  }
}

function occurrences(event, fromMs, toMs_) {
  const startMs = toMs(event.start);
  const durationMs = event.end ? toMs(event.end) - startMs : (event.start.allDay ? DAY_MS : 0);
  if (!event.rrule) {
    return startMs + durationMs > fromMs && startMs < toMs_ ? [{ startMs, durationMs }] : [];
  }

  const { rule, until } = { rule: event.rrule, until: event.rrule.until ? toMs(event.rrule.until) : Infinity };
  const found = [];
  let produced = 0;
  for (const date of ruleDates(event.start, rule)) {
    const occurrence = { ...event.start, wall: { ...event.start.wall, ...date } };
    const ms = toMs(occurrence);
    if (ms < startMs) continue;
    if (ms > until || ms >= toMs_) break;
    produced += 1;
    if (rule.count && produced > rule.count) break;
    if (!event.exdates.has(ms) && ms + durationMs > fromMs) found.push({ startMs: ms, durationMs });
  }
  return found;
}

function expand(text, fromMs, toMs_, source) {
  const events = parseEvents(text);
  const overrides = new Map();
  for (const event of events) {
    if (event.recurrenceId) overrides.set(`${event.uid}|${toMs(event.recurrenceId)}`, event);
  }
  const results = [];
  const push = (event, startMs, durationMs) => {
    results.push({
      id: `${event.uid || event.title}|${startMs}`,
      title: event.title || '(no title)',
      location: event.location || '',
      join: joinLink(event),
      start: startMs,
      end: startMs + durationMs,
      allDay: event.start.allDay,
      source,
    });
  };

  for (const event of events) {
    if (event.recurrenceId) {
      if (event.cancelled) continue;
      for (const { startMs, durationMs } of occurrences(event, fromMs, toMs_)) push(event, startMs, durationMs);
      continue;
    }
    if (event.cancelled) continue;
    for (const { startMs, durationMs } of occurrences(event, fromMs, toMs_)) {
      if (!overrides.has(`${event.uid}|${startMs}`)) push(event, startMs, durationMs);
    }
  }
  return results.sort((a, b) => a.start - b.start);
}

async function fetchCalendars(calendars, fetcher = fetch) {
  const from = Date.now() - PAST_DAYS * DAY_MS;
  const to = Date.now() + FUTURE_DAYS * DAY_MS;
  const events = [];
  const errors = [];
  await Promise.all(calendars.map(async (calendar) => {
    try {
      const url = calendar.url.trim().replace(/^webcal:/i, 'https:');
      const response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('this link is not an iCal calendar');
      events.push(...expand(text, from, to, calendar.name));
    } catch (err) {
      errors.push(`${calendar.name}: ${err.message}`);
    }
  }));
  return { events: events.sort((a, b) => a.start - b.start), errors, at: Date.now() };
}

module.exports = { expand, fetchCalendars, wallToUtc };
