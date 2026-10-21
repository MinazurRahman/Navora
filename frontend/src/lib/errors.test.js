import { describe, expect, it } from 'vitest';
import { safeNext } from '../features/auth/safeNext.js';
import { errorMessage, fieldErrors } from './errors.js';

describe('errorMessage', () => {
  it('uses the Retry-After wait for rate limits', () => {
    expect(errorMessage({ code: 'RATE_LIMITED', retryAfter: 30 })).toBe('Too many requests. Try again in 30 seconds.');
    expect(errorMessage({ code: 'RATE_LIMITED', retryAfter: 90 })).toBe('Too many requests. Try again in 2 minutes.');
  });

  it('hides internal failures behind a plain message and passes other messages through', () => {
    expect(errorMessage({ code: 'INTERNAL_ERROR', message: 'stack trace' })).toBe('Something went wrong on our side. Try again.');
    expect(errorMessage({ code: 'TRIP_NOT_FOUND', message: 'Trip not found' })).toBe('Trip not found');
  });
});

describe('fieldErrors', () => {
  it('maps body validation details by path, first message wins', () => {
    const error = {
      code: 'VALIDATION_ERROR',
      details: [
        { location: 'body', path: 'location.latitude', message: 'Too big' },
        { location: 'body', path: 'location.latitude', message: 'Second' },
        { location: 'query', path: 'page', message: 'Ignored' },
      ],
    };
    expect(fieldErrors(error)).toEqual({ 'location.latitude': 'Too big' });
  });

  it('returns nothing for other errors', () => {
    expect(fieldErrors({ code: 'RATE_LIMITED' })).toEqual({});
  });
});

describe('safeNext', () => {
  it('accepts same-site paths only', () => {
    expect(safeNext('/trips?x=1')).toBe('/trips?x=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
