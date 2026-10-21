// Display formatting. "Unknown is unknown": null values get explicit wording, never a guess.

const number = new Intl.NumberFormat('en');

// entryFee: null = unknown, 0 = free.
export function formatEntryFee(amount, currency = 'BDT') {
  if (amount === null || amount === undefined) return 'Entry fee unknown';
  if (amount === 0) return 'Free entry';
  return `${currency} ${number.format(amount)}`;
}

// rating: { average: number | null, count }
export function formatRating({ average, count }) {
  if (!count || average === null) return 'No reviews yet';
  return `${average.toFixed(1)} (${count} review${count === 1 ? '' : 's'})`;
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined) return null;
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// "YYYY-MM-DD" (a calendar date, no timezone) -> "Wednesday 21 October".
const dayDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export function formatDayDate(isoDate) {
  return dayDate.format(new Date(`${isoDate}T00:00:00Z`));
}
