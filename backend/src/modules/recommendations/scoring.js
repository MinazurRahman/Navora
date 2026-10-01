// Rule-based recommendation scoring. Pure functions over place DTOs: no I/O, fully
// unit-tested. Hard constraints filter first; soft preferences then rank what is left.
//
// Honesty rules: UNKNOWN facility data never satisfies a requirement; unknown fee,
// ratings or hours are scored low (config.unknownScore) and surfaced as warnings; reasons
// only state facts present in the data.
import { openDaysCount, toMinutes, tripDays } from './schedule.js';

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const km = (meters) => Math.round(meters / 100) / 10;

// Request (validated API input) + resolved start date → everything scoring needs.
export function buildContext(input, startDate) {
  const days = tripDays(startDate, input.durationDays);
  let budget = null;
  if (input.budget) {
    const total = input.budget.type === 'total' ? input.budget.amount : input.budget.amount * input.durationDays;
    budget = { currency: input.budget.currency, total, daily: total / input.durationDays };
  }
  return {
    radiusKm: input.searchRadiusKm,
    radiusMeters: input.searchRadiusKm * 1000,
    interests: input.interests,
    preferredCategories: input.preferredCategories,
    budget,
    days,
    windowStart: toMinutes(input.dailyStartTime),
    windowEnd: toMinutes(input.dailyEndTime),
    travelingWithPet: input.travelingWithPet,
    parkingRequired: input.parkingRequired,
    wheelchairAccessRequired: input.wheelchairAccessRequired,
    minimumRating: input.minimumRating,
  };
}

function openDays(place, ctx, config) {
  return openDaysCount(place.openingHours, ctx.days, {
    windowStart: ctx.windowStart,
    windowEnd: ctx.windowEnd,
    visitMinutes: place.typicalVisitMinutes ?? config.defaultVisitMinutes,
  });
}

// Each constraint applies only when the user asked for it. Facility requirements need an
// explicit YES: NO and UNKNOWN both fail.
export const HARD_CONSTRAINTS = [
  {
    key: 'searchRadius',
    applies: () => true,
    passes: (place, ctx) => place.distanceMeters <= ctx.radiusMeters,
  },
  {
    key: 'petFriendly',
    applies: (ctx) => ctx.travelingWithPet,
    passes: (place) => place.facilities.petFriendly === 'YES',
    reason: 'Pet-friendly (matches your pet requirement)',
  },
  {
    key: 'parking',
    applies: (ctx) => ctx.parkingRequired,
    passes: (place) => place.facilities.parking === 'YES',
    reason: 'Parking available (matches your parking requirement)',
  },
  {
    key: 'wheelchairAccessible',
    applies: (ctx) => ctx.wheelchairAccessRequired,
    passes: (place) => place.facilities.wheelchairAccessible === 'YES',
    reason: 'Wheelchair accessible (matches your accessibility requirement)',
  },
  {
    key: 'minimumRating',
    applies: (ctx) => ctx.minimumRating !== undefined,
    // Unrated places have no rating to meet the minimum with.
    passes: (place, ctx) => place.rating.average !== null && place.rating.average >= ctx.minimumRating,
  },
  {
    // Only when hours are KNOWN and the place is closed for the whole trip: a certain
    // impossibility, not a preference. Unknown hours never exclude.
    key: 'openDuringTrip',
    applies: () => true,
    passes: (place, ctx, config) => openDays(place, ctx, config) !== 0,
  },
];

// Returns eligible places and, per constraint, how many places it excluded. A place that
// fails several constraints is counted under each, so the counts show which requirement
// is the limiting one.
export function applyHardConstraints(places, ctx, config) {
  const eligible = [];
  const excludedBy = {};
  for (const place of places) {
    const failed = HARD_CONSTRAINTS.filter((c) => c.applies(ctx) && !c.passes(place, ctx, config));
    for (const c of failed) excludedBy[c.key] = (excludedBy[c.key] ?? 0) + 1;
    if (failed.length === 0) eligible.push(place);
  }
  return { eligible, excludedBy };
}

function budgetComponent(place, budget, config, reasons, warnings) {
  if (place.entryFee === null || place.currency !== budget.currency) {
    warnings.push('Entry fee unknown');
    return config.unknownScore;
  }
  const fee = `${place.currency} ${place.entryFee}`;
  if (place.entryFee === 0) {
    reasons.push('Free entry');
    return 1;
  }
  if (place.entryFee <= budget.daily) {
    reasons.push(`Entry fee ${fee} fits your budget`);
    return clamp01(1 - place.entryFee / budget.daily);
  }
  if (place.entryFee <= budget.total) {
    warnings.push(`Entry fee ${fee} is more than your daily budget`);
    return 0.1;
  }
  warnings.push(`Entry fee ${fee} is more than your total budget`);
  return 0;
}

// Scores one eligible place: { score 0–100, breakdown (0–100 per component), reasons, warnings }.
export function scorePlace(place, ctx, config) {
  const components = {};
  const reasons = [];
  const warnings = [];

  for (const c of HARD_CONSTRAINTS) {
    if (c.reason && c.applies(ctx)) reasons.push(c.reason);
  }

  if (ctx.interests.length > 0) {
    const matched = ctx.interests.filter((interest) => place.tags.includes(interest));
    components.interest = matched.length / ctx.interests.length;
    if (matched.length > 0) reasons.push(`Matches your interests: ${matched.join(', ')}`);
  }

  if (ctx.preferredCategories.length > 0) {
    const hit = ctx.preferredCategories.includes(place.category.slug);
    components.category = hit ? 1 : 0;
    if (hit) reasons.push(`In a preferred category: ${place.category.name}`);
  }

  components.proximity = clamp01(1 - place.distanceMeters / ctx.radiusMeters);
  reasons.push(`${km(place.distanceMeters)} km away, within your ${ctx.radiusKm} km search radius`);

  if (ctx.budget) components.budget = budgetComponent(place, ctx.budget, config, reasons, warnings);

  const { average, count } = place.rating;
  if (count > 0) {
    const { mean, weight } = config.ratingPrior;
    const bayesian = (mean * weight + average * count) / (weight + count);
    components.rating = clamp01((bayesian - 1) / 4);
    reasons.push(`Rated ${average} from ${count} review${count === 1 ? '' : 's'}`);
  } else {
    components.rating = config.unknownScore;
    warnings.push('No ratings yet');
  }

  components.popularity = clamp01(Math.log1p(count) / Math.log1p(config.popularityTargetReviews));

  const open = openDays(place, ctx, config);
  if (open === null) {
    components.schedule = config.unknownScore;
    warnings.push('Opening hours could not be verified');
  } else {
    components.schedule = open / ctx.days.length;
    reasons.push(
      open === ctx.days.length
        ? `Open during your daily hours on ${open === 1 ? 'your trip day' : `all ${open} trip days`}`
        : `Open during your daily hours on ${open} of ${ctx.days.length} trip days`,
    );
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const [name, value] of Object.entries(components)) {
    weighted += config.weights[name] * value;
    totalWeight += config.weights[name];
  }

  return {
    score: totalWeight > 0 ? Math.round((100 * weighted) / totalWeight) : 0,
    breakdown: Object.fromEntries(Object.entries(components).map(([name, value]) => [name, Math.round(value * 100)])),
    reasons,
    warnings,
  };
}

// Highest score first; ties: closer first, then by ID (stable, deterministic).
export function rankPlaces(places, ctx, config) {
  return places
    .map((place) => ({ place, ...scorePlace(place, ctx, config) }))
    .sort((a, b) => b.score - a.score || a.place.distanceMeters - b.place.distanceMeters || a.place.id.localeCompare(b.place.id));
}

const SUGGESTIONS = {
  petFriendly: (n) => `${n} nearby place${n === 1 ? ' is' : 's are'} not confirmed pet-friendly`,
  parking: (n) => `${n} nearby place${n === 1 ? ' is' : 's are'} not confirmed to have parking`,
  wheelchairAccessible: (n) => `${n} nearby place${n === 1 ? ' is' : 's are'} not confirmed wheelchair accessible`,
  minimumRating: (n) => `${n} nearby place${n === 1 ? '' : 's'} did not meet your minimum rating; consider lowering it`,
  openDuringTrip: (n) => `${n} nearby place${n === 1 ? ' is' : 's are'} closed during your daily hours on every trip day; consider different hours or dates`,
};

// When few places qualify: say which requirements limited the results, most limiting
// first. Mandatory requirements are reported, never silently relaxed.
export function buildSuggestions(excludedBy, ctx, maxRadiusKm) {
  const suggestions = Object.entries(excludedBy)
    .filter(([key]) => SUGGESTIONS[key])
    .sort(([, a], [, b]) => b - a)
    .map(([key, n]) => SUGGESTIONS[key](n));
  if (ctx.radiusKm < maxRadiusKm) suggestions.push(`Increase the search radius (currently ${ctx.radiusKm} km)`);
  return suggestions;
}
