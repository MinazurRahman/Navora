// The place submission form: values, checks and the request body for POST /places and
// PATCH /places/:id (backend PlaceInput). "Unknown" is a real answer here: facilities,
// entry fee and opening hours can all stay unknown, and unknown never counts as yes.

export const FACILITY_FIELDS = [
  ['parkingAvailable', 'Parking'],
  ['petFriendly', 'Pet-friendly'],
  ['wheelchairAccessible', 'Wheelchair accessible'],
];

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_HOURS_ENTRIES = 28;
const emptyWeek = () => Object.fromEntries(DAYS.map((_, i) => [i + 1, []]));

export function initialPlaceForm() {
  return {
    name: '',
    description: '',
    category: '',
    location: null,
    address: '',
    city: 'Dhaka',
    feeMode: 'unknown', // unknown | free | amount
    entryFee: '',
    typicalVisitMinutes: '',
    parkingAvailable: 'UNKNOWN',
    petFriendly: 'UNKNOWN',
    wheelchairAccessible: 'UNKNOWN',
    accessibilityNotes: '',
    restrictions: '',
    tags: [],
    hoursKnown: false,
    hours: emptyWeek(), // { 1: [{ opensAt, closesAt }], ... }; [] = closed that day
  };
}

// A Place from the API as form values (for editing a submission).
export function placeToForm(place) {
  const hours = emptyWeek();
  for (const { dayOfWeek, opensAt, closesAt } of place.openingHours) hours[dayOfWeek].push({ opensAt, closesAt });
  return {
    name: place.name,
    description: place.description ?? '',
    category: place.category.slug,
    location: place.location,
    address: place.address ?? '',
    city: place.city ?? '',
    feeMode: place.entryFee === null ? 'unknown' : place.entryFee === 0 ? 'free' : 'amount',
    entryFee: place.entryFee ? String(place.entryFee) : '',
    typicalVisitMinutes: place.typicalVisitMinutes === null ? '' : String(place.typicalVisitMinutes),
    parkingAvailable: place.facilities.parking,
    petFriendly: place.facilities.petFriendly,
    wheelchairAccessible: place.facilities.wheelchairAccessible,
    accessibilityNotes: place.facilities.accessibilityNotes ?? '',
    restrictions: place.facilities.restrictions ?? '',
    tags: place.tags,
    hoursKnown: place.openingHours.length > 0,
    hours,
  };
}

function hoursProblem(form) {
  const ranges = Object.values(form.hours).flat();
  if (ranges.length === 0) return 'Add hours for at least one day, or choose "Opening hours unknown".';
  if (ranges.length > MAX_HOURS_ENTRIES) return `Use at most ${MAX_HOURS_ENTRIES} time ranges.`;
  for (const [day, dayRanges] of Object.entries(form.hours)) {
    const name = DAYS[day - 1];
    const sorted = [...dayRanges].sort((a, b) => a.opensAt.localeCompare(b.opensAt));
    for (const [i, { opensAt, closesAt }] of sorted.entries()) {
      if (!opensAt || !closesAt) return `${name}: enter both times.`;
      if (opensAt >= closesAt) return `${name}: closing time must be after opening time. Split overnight hours across two days.`;
      if (i > 0 && opensAt < sorted[i - 1].closesAt) return `${name}: time ranges overlap.`;
    }
  }
  return null;
}

export function validatePlaceForm(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Enter the place name.';
  if (!form.category) errors.category = 'Choose a category.';
  if (!form.location) errors.location = 'Mark the place on the map or enter its coordinates.';
  if (form.feeMode === 'amount') {
    const fee = Number(form.entryFee);
    if (form.entryFee === '' || !Number.isFinite(fee) || fee <= 0 || fee > 1_000_000) {
      errors.entryFee = 'Enter an amount above 0, or choose free or unknown.';
    } else if (!/^\d+(\.\d{1,2})?$/.test(form.entryFee.trim())) {
      errors.entryFee = 'Use at most 2 decimal places.';
    }
  }
  if (form.typicalVisitMinutes !== '') {
    const minutes = Number(form.typicalVisitMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) errors.typicalVisitMinutes = 'Enter 5 to 720 minutes.';
  }
  if (form.tags.length > 10) errors.tags = 'Choose up to 10 interests.';
  if (form.hoursKnown) {
    const problem = hoursProblem(form);
    if (problem) errors.openingHours = problem;
  }
  return errors;
}

const textOrNull = (value) => value.trim() || null;

export function buildPlacePayload(form) {
  return {
    name: form.name.trim(),
    description: textOrNull(form.description),
    category: form.category,
    location: {
      latitude: Math.round(form.location.latitude * 1e6) / 1e6,
      longitude: Math.round(form.location.longitude * 1e6) / 1e6,
    },
    address: textOrNull(form.address),
    city: textOrNull(form.city),
    entryFee: form.feeMode === 'unknown' ? null : form.feeMode === 'free' ? 0 : Number(form.entryFee),
    typicalVisitMinutes: form.typicalVisitMinutes === '' ? null : Number(form.typicalVisitMinutes),
    parkingAvailable: form.parkingAvailable,
    petFriendly: form.petFriendly,
    wheelchairAccessible: form.wheelchairAccessible,
    accessibilityNotes: textOrNull(form.accessibilityNotes),
    restrictions: textOrNull(form.restrictions),
    tags: form.tags,
    // [] tells the backend the hours are unknown.
    openingHours: form.hoursKnown
      ? Object.entries(form.hours).flatMap(([day, ranges]) =>
          [...ranges]
            .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
            .map(({ opensAt, closesAt }) => ({ dayOfWeek: Number(day), opensAt, closesAt })),
        )
      : [],
  };
}

// Backend validation paths ("location.latitude", "openingHours.3.closesAt") to form fields.
export function toPlaceFormErrors(serverFieldErrors) {
  const errors = {};
  for (const [path, message] of Object.entries(serverFieldErrors)) {
    errors[path.split('.')[0]] ??= message;
  }
  return errors;
}
