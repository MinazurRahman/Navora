import { describe, expect, it } from 'vitest';
import { dhakaWeekday, weeklySchedule } from './openingHours.js';

describe('weeklySchedule', () => {
  it('treats an empty list as unknown, not open', () => {
    expect(weeklySchedule([])).toBeNull();
    expect(weeklySchedule(undefined)).toBeNull();
  });

  it('lists every day; missing days are closed and split hours are ordered', () => {
    const schedule = weeklySchedule([
      { dayOfWeek: 1, opensAt: '15:00', closesAt: '20:00' },
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' },
      { dayOfWeek: 5, opensAt: '10:00', closesAt: '17:00' },
    ]);
    expect(schedule).toHaveLength(7);
    expect(schedule[0]).toEqual({ dayOfWeek: 1, day: 'Monday', ranges: ['09:00–12:00', '15:00–20:00'] });
    expect(schedule[1].ranges).toEqual([]);
    expect(schedule[4].ranges).toEqual(['10:00–17:00']);
  });
});

describe('dhakaWeekday', () => {
  it('uses Dhaka time, not the device timezone', () => {
    // 2026-10-18 20:00 UTC is Monday 02:00 in Dhaka (UTC+6).
    expect(dhakaWeekday(new Date('2026-10-18T20:00:00Z'))).toBe(1);
    expect(dhakaWeekday(new Date('2026-10-18T17:00:00Z'))).toBe(7);
  });
});
