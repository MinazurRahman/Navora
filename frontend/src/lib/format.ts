// Display helpers. Navora's defaults: Asia/Dhaka time, BDT currency.
// Rule: null means UNKNOWN — never show it as free, zero, or open.

import type { FacilityStatus, OpeningHours, TravelMode } from '../api/types';

export const TIME_ZONE = 'Asia/Dhaka';

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatMoney(amount: number | null | undefined, currency = 'BDT'): string {
  if (amount === null || amount === undefined) return 'Unknown';
  if (amount === 0) return 'Free';
  return `${currency === 'BDT' ? '৳' : `${currency} `}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function formatEntryFee(fee: number | null, currency: string): string {
  return fee === null ? 'Fee unknown' : fee === 0 ? 'Free entry' : `${formatMoney(fee, currency)} entry`;
}

export function formatRating(average: number | null, count: number): string {
  if (average === null || count === 0) return 'No reviews yet';
  return `${average.toFixed(1)} from ${count} review${count === 1 ? '' : 's'}`;
}

/** "2026-10-05" → "Mon 5 Oct". Dates are plain calendar dates; no time zone shifting. */
export function formatDate(date: string | null | undefined, withYear = false): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(Date.UTC(y, m - 1, d));
  return value.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
}

/** Today's date in Dhaka as "YYYY-MM-DD". */
export function todayInDhaka(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

export const FACILITY_LABEL: Record<FacilityStatus, string> = {
  YES: 'Yes',
  NO: 'No',
  UNKNOWN: 'Unknown',
};

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  car: 'Car',
  walking: 'Walking',
  cycling: 'Cycling',
  public_transport: 'Public transport',
};

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Opening hours grouped per ISO weekday; empty input = unknown. */
export function hoursByDay(hours: OpeningHours[]): { day: string; text: string }[] {
  return WEEKDAYS.map((day, index) => {
    const entries = hours
      .filter((h) => h.dayOfWeek === index + 1)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((h) => `${h.opensAt}–${h.closesAt}`);
    return { day, text: entries.length ? entries.join(', ') : 'Closed' };
  });
}

export function titleCase(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
