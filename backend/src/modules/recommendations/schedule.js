// Pure date/time helpers for schedule compatibility (no I/O).

export function toMinutes(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

// "YYYY-MM-DD" in an IANA timezone (not the server's zone, which may differ per instance).
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// [{ date: "YYYY-MM-DD", dayOfWeek: 1–7 (ISO, Monday = 1) }] for each trip day.
export function tripDays(startDate, durationDays) {
  const [y, m, d] = startDate.split('-').map(Number);
  return Array.from({ length: durationDays }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    return { date: day.toISOString().slice(0, 10), dayOfWeek: ((day.getUTCDay() + 6) % 7) + 1 };
  });
}

// How many trip days the place is open long enough for a visit inside the user's daily
// window. null = opening hours unknown (never assumed open).
export function openDaysCount(openingHours, days, { windowStart, windowEnd, visitMinutes }) {
  if (openingHours.length === 0) return null;
  return days.filter(({ dayOfWeek }) =>
    openingHours.some((h) => {
      if (h.dayOfWeek !== dayOfWeek) return false;
      const start = Math.max(toMinutes(h.opensAt), windowStart);
      const end = Math.min(toMinutes(h.closesAt), windowEnd);
      return end - start >= visitMinutes;
    }),
  ).length;
}
