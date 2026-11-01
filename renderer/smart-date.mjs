// Understands task text like "Call mom kal 7 baje", "pay rent tomorrow 9am" or "standup every mon 10am".
const DAY_MS = 86400000;
const DEFAULT_HOUR = 9;

const WEEKDAYS = [
  ['sunday', 'ravivar', 'itwar', 'sun'],
  ['monday', 'somvar', 'mon'],
  ['tuesday', 'mangalvar', 'tue'],
  ['wednesday', 'budhvar', 'wed'],
  ['thursday', 'guruvar', 'thu'],
  ['friday', 'shukravar', 'fri'],
  ['saturday', 'shanivar', 'sat'],
];
const FULL_NAMES = WEEKDAYS.flatMap((names) => names.slice(0, -1)).join('|');
const ANY_NAME = WEEKDAYS.flat().join('|');
const dayIndex = (word) => WEEKDAYS.findIndex((names) => names.includes(word.toLowerCase()));

function to24(hour, minute, meridian) {
  if (hour > 23 || minute > 59) return null;
  let h = hour;
  if (meridian === 'pm' && h < 12) h += 12;
  if (meridian === 'am' && h === 12) h = 0;
  return { h, m: minute };
}

function atTime(day, time) {
  const date = new Date(day);
  date.setHours(time.h, time.m, 0, 0);
  return date.getTime();
}

export function nextOccurrence(repeat, time, after) {
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = atTime(after + offset * DAY_MS, time);
    if (candidate > after && repeat.days.includes(new Date(candidate).getDay())) return candidate;
  }
  return null;
}

export function parseTask(input, now = Date.now()) {
  let rest = ` ${input.trim()} `;
  const take = (pattern) => {
    const match = rest.match(pattern);
    if (match) rest = rest.replace(match[0], ' ');
    return match;
  };

  let repeat = null;
  const everyDay = take(/\s(?:every\s?day|daily|roz(?:ana)?|har\s+din)(?=\s)/i);
  if (everyDay) repeat = { days: [0, 1, 2, 3, 4, 5, 6] };
  const everyWeekday = !repeat && take(new RegExp(`\\s(?:every|har)\\s+(${ANY_NAME})(?=\\s)`, 'i'));
  if (everyWeekday) repeat = { days: [dayIndex(everyWeekday[1])] };

  const relative = take(/\s(?:in\s+)?(\d{1,3})\s*(minutes?|mins?|min|hours?|hrs?|hr|ghante|ghanta|minute)(?:\s+(?:baad|mein|me))?(?=\s)/i);
  if (relative && (/^in\b/i.test(relative[0].trim()) || /baad|mein|me\b/i.test(relative[0]))) {
    const amount = Number(relative[1]) * (/^(h|g)/i.test(relative[2]) ? 3600000 : 60000);
    return { text: rest.trim().replace(/\s+/g, ' '), due: now + amount, repeat: null };
  }
  if (relative) rest = ` ${input.trim()} `; // a plain "2 hours" is part of the task, not a reminder

  let time = null;
  const period = take(/\s(subah|dopahar|sham|shaam|raat)\s+(\d{1,2})(?::(\d{2}))?(?:\s*baje)?(?=\s)/i);
  if (period) {
    const meridian = period[1].toLowerCase() === 'subah' ? 'am' : 'pm';
    time = to24(Number(period[2]), Number(period[3] || 0), meridian);
  }
  if (!time) {
    const meridian = take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?=\s)/i);
    if (meridian) time = to24(Number(meridian[1]), Number(meridian[2] || 0), meridian[3].toLowerCase());
  }
  let guessed = false;
  if (!time) {
    const plain = take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*baje(?=\s)/i) || take(/\sat\s+(\d{1,2})(?::(\d{2}))?(?=\s)/i)
      || take(/\s(\d{1,2}):(\d{2})(?=\s)/);
    if (plain) {
      time = to24(Number(plain[1]), Number(plain[2] || 0));
      guessed = Boolean(time) && time.h >= 1 && time.h <= 12;
    }
  }

  let day = null;
  if (take(/\s(?:day after tomorrow|parso)(?=\s)/i)) day = now + 2 * DAY_MS;
  else if (take(/\s(?:tomorrow|tmrw|kal)(?=\s)/i)) day = now + DAY_MS;
  else if (take(/\s(?:today|tonight|aaj)(?=\s)/i)) day = now;

  if (day === null) {
    const weekday = take(new RegExp(`\\s(?:(?:on|next)\\s+(${ANY_NAME})|(${FULL_NAMES}))(?=\\s)`, 'i'));
    if (weekday) {
      const target = dayIndex(weekday[1] || weekday[2]);
      day = now + (((target - new Date(now).getDay() + 7) % 7) || 7) * DAY_MS;
    }
  }

  const text = rest.trim().replace(/\s+/g, ' ');
  if (repeat) {
    const at = time || { h: DEFAULT_HOUR, m: 0 };
    return { text, due: nextOccurrence(repeat, at, now), repeat: { ...repeat, ...at } };
  }
  if (day === null && !time) return { text: input.trim(), due: null, repeat: null };

  const chosen = time || { h: DEFAULT_HOUR, m: 0 };
  let due = atTime(day ?? now, chosen);
  if (day === null && due <= now) {
    // "at 7" at 3 pm means 7 pm; a time that has really gone means tomorrow.
    const evening = guessed && chosen.h < 12 ? atTime(now, { h: chosen.h + 12, m: chosen.m }) : 0;
    due = evening > now ? evening : atTime(now + DAY_MS, chosen);
  }
  return { text, due, repeat: null };
}
