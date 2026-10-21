// Weekly opening hours as the API sends them: [{ dayOfWeek: 1-7 (ISO, 1 = Monday), opensAt, closesAt }].
// An empty list means the hours are unknown (never assume open). When some days are
// listed, a day that is missing is closed.
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// null when unknown; otherwise one entry per day, Monday first: { dayOfWeek, day, ranges }.
// ranges is [] for a closed day, or strings like '09:00–17:00' in time order.
export function weeklySchedule(openingHours) {
  if (!openingHours?.length) return null;
  return DAYS.map((day, index) => ({
    dayOfWeek: index + 1,
    day,
    ranges: openingHours
      .filter((h) => h.dayOfWeek === index + 1)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((h) => `${h.opensAt}–${h.closesAt}`),
  }));
}

// ISO weekday (1 = Monday) right now in Dhaka, the timezone the backend uses for hours.
export function dhakaWeekday(date = new Date()) {
  const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Dhaka' }).format(date);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(short) + 1;
}
