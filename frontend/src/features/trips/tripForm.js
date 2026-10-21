// The trip-planning wizard's form: initial values, per-step checks and the exact request
// body for POST /trips (backend TripFields). Client checks are for usability only; the
// backend validates everything again.

export const STEPS = [
  { id: 'basics', title: 'Where and when' },
  { id: 'interests', title: 'Interests' },
  { id: 'places', title: 'Categories and places' },
  { id: 'travel', title: 'Travel and budget' },
  { id: 'requirements', title: 'Requirements' },
  { id: 'review', title: 'Review' },
];

export const TRAVEL_MODES = [
  { value: 'car', label: 'Car' },
  { value: 'walking', label: 'Walking' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'public_transport', label: 'Public transport' },
];

export const MAX_DAYS = 14;
const MAX_CHOICES = 10;
const MAX_SELECTED_PLACES = 30;

// Today's date in Dhaka (the backend's "today"), as YYYY-MM-DD.
export function todayInDhaka(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date);
}

export function initialForm() {
  return {
    title: '',
    location: null, // { latitude, longitude }
    startAddress: '',
    startDate: '', // empty = start today
    durationDays: '2',
    dailyStartTime: '09:00',
    dailyEndTime: '20:00',
    interests: [],
    preferredCategories: [],
    selectedPlaceIds: [],
    travelMode: 'car',
    searchRadiusKm: '10',
    budgetAmount: '',
    budgetType: 'total',
    partySize: '1',
    minimumRating: '',
    travelingWithPet: false,
    parkingRequired: false,
    wheelchairAccessRequired: false,
  };
}

// A saved trip (GET /trips/:id) as wizard form values, for changing its settings.
export function formFromTrip(trip) {
  return {
    title: trip.title,
    location: trip.startLocation,
    startAddress: trip.startAddress ?? '',
    startDate: trip.startDate ?? '',
    durationDays: String(trip.durationDays),
    dailyStartTime: trip.dailyStartTime,
    dailyEndTime: trip.dailyEndTime,
    interests: trip.interests,
    preferredCategories: trip.preferredCategories,
    selectedPlaceIds: trip.selectedPlaceIds,
    travelMode: trip.travelMode,
    searchRadiusKm: String(trip.searchRadiusKm),
    budgetAmount: trip.budget ? String(trip.budget.amount) : '',
    budgetType: trip.budget?.type ?? 'total',
    partySize: String(trip.partySize),
    minimumRating: trip.minimumRating === null ? '' : String(trip.minimumRating),
    travelingWithPet: trip.travelingWithPet,
    parkingRequired: trip.parkingRequired,
    wheelchairAccessRequired: trip.wheelchairAccessRequired,
  };
}

const isWholeNumber = (value, min, max) => /^\d+$/.test(String(value)) && Number(value) >= min && Number(value) <= max;

// Errors for one step, keyed by form field. Empty object = the step is complete.
export function validateStep(stepId, form, today = todayInDhaka()) {
  const errors = {};
  if (stepId === 'basics') {
    if (!form.title.trim()) errors.title = 'Give your trip a name.';
    if (!form.location) errors.location = 'Choose where each day starts.';
    if (!isWholeNumber(form.durationDays, 1, MAX_DAYS)) errors.durationDays = `Choose 1 to ${MAX_DAYS} days.`;
    if (form.startDate && form.startDate < today) errors.startDate = 'Choose today or a later date.';
    if (form.dailyStartTime >= form.dailyEndTime) errors.dailyEndTime = 'The day must end after it starts.';
  }
  if (stepId === 'interests' && form.interests.length > MAX_CHOICES) {
    errors.interests = `Choose up to ${MAX_CHOICES} interests.`;
  }
  if (stepId === 'places') {
    if (form.preferredCategories.length > MAX_CHOICES) errors.preferredCategories = `Choose up to ${MAX_CHOICES} categories.`;
    if (form.selectedPlaceIds.length > MAX_SELECTED_PLACES) errors.selectedPlaceIds = `Choose up to ${MAX_SELECTED_PLACES} places.`;
  }
  if (stepId === 'travel') {
    if (form.budgetAmount !== '') {
      const amount = Number(form.budgetAmount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) errors.budgetAmount = 'Enter an amount of 0 or more.';
    }
    if (!isWholeNumber(form.partySize, 1, 50)) errors.partySize = 'Enter 1 to 50 people.';
  }
  return errors;
}

// Request body for POST /trips and PATCH /trips/:id.
export function buildTripPayload(form) {
  return {
    title: form.title.trim(),
    startLocation: {
      latitude: Math.round(form.location.latitude * 1e6) / 1e6,
      longitude: Math.round(form.location.longitude * 1e6) / 1e6,
    },
    startAddress: form.startAddress.trim() || null,
    startDate: form.startDate || null, // null: the planner starts today (Dhaka)
    durationDays: Number(form.durationDays),
    dailyStartTime: form.dailyStartTime,
    dailyEndTime: form.dailyEndTime,
    searchRadiusKm: Number(form.searchRadiusKm),
    budget: form.budgetAmount === '' ? null : { amount: Number(form.budgetAmount), type: form.budgetType },
    travelMode: form.travelMode,
    travelingWithPet: form.travelingWithPet,
    parkingRequired: form.parkingRequired,
    wheelchairAccessRequired: form.wheelchairAccessRequired,
    partySize: Number(form.partySize),
    minimumRating: form.minimumRating === '' ? null : Number(form.minimumRating),
    interests: form.interests,
    preferredCategories: form.preferredCategories,
    selectedPlaceIds: form.selectedPlaceIds,
  };
}

// Backend validation paths (e.g. "startLocation.latitude", "budget.amount") to form fields.
const PATH_TO_FIELD = {
  startLocation: 'location',
  budget: 'budgetAmount',
};

const FIELD_STEP = {
  title: 'basics',
  location: 'basics',
  startAddress: 'basics',
  startDate: 'basics',
  durationDays: 'basics',
  dailyStartTime: 'basics',
  dailyEndTime: 'basics',
  interests: 'interests',
  preferredCategories: 'places',
  selectedPlaceIds: 'places',
  travelMode: 'travel',
  searchRadiusKm: 'travel',
  budgetAmount: 'travel',
  partySize: 'travel',
  minimumRating: 'travel',
  travelingWithPet: 'requirements',
  parkingRequired: 'requirements',
  wheelchairAccessRequired: 'requirements',
};

// { 'budget.amount': 'Too big' } -> { budgetAmount: 'Too big' }
export function toFormErrors(serverFieldErrors) {
  const errors = {};
  for (const [path, message] of Object.entries(serverFieldErrors)) {
    const root = path.split('.')[0];
    const field = PATH_TO_FIELD[root] ?? root;
    errors[field] ??= message;
  }
  return errors;
}

// The first step (in order) that has one of these errors, or null.
export function firstStepWithError(errors) {
  const steps = new Set(Object.keys(errors).map((field) => FIELD_STEP[field]).filter(Boolean));
  return STEPS.find((step) => steps.has(step.id))?.id ?? null;
}
