// Validates and bounds the model's reply. Pure. The model is untrusted: only place
// references that exist in the context survive, suggestions must fit the itinerary, and
// every text is length-capped. Returns null when the reply is unusable.
import { SUGGESTION_TYPES } from './prompt.js';

const REF = /\bP\d+\b/g;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Cuts at a word boundary when one is close, and marks the cut.
function truncate(text, max) {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > max * 0.8) cut = cut.slice(0, lastSpace);
  return { text: `${cut.trimEnd()}…`, truncated: true };
}

// Which refs mean what, from the context the model was given.
function catalogue(context) {
  const names = new Map();
  const itineraryRefs = new Set();
  for (const day of context.itinerary?.days ?? []) {
    for (const stop of day.stops) {
      itineraryRefs.add(stop.place);
      names.set(stop.place, stop.name);
    }
  }
  for (const [ref, place] of Object.entries(context.places)) if (!names.has(ref)) names.set(ref, place.name);
  const recommendedOnly = new Set((context.recommendations?.results ?? []).filter((r) => !r.inItinerary).map((r) => r.place));
  const days = new Set((context.itinerary?.days ?? []).map((d) => d.dayNumber));
  return { names, itineraryRefs, recommendedOnly, days };
}

function validSuggestion(raw, { names, itineraryRefs, recommendedOnly, days }) {
  if (!isPlainObject(raw) || !SUGGESTION_TYPES.includes(raw.type)) return false;
  if (typeof raw.rationale !== 'string' || raw.rationale.trim() === '') return false;
  const dayOk = (n) => Number.isInteger(n) && days.has(n);
  if (raw.dayNumber !== undefined && !dayOk(raw.dayNumber)) return false;
  if (raw.place !== undefined && !names.has(raw.place)) return false;

  switch (raw.type) {
    case 'REORDER_DAY':
      return raw.dayNumber !== undefined;
    case 'MOVE_STOP':
      return itineraryRefs.has(raw.place) && dayOk(raw.targetDayNumber);
    case 'ADD_RECOMMENDED_PLACE':
      return recommendedOnly.has(raw.place);
    default: // REMOVE_STOP, VERIFY_OPENING_HOURS, VERIFY_ENTRY_FEE
      return itineraryRefs.has(raw.place);
  }
}

/**
 * @param raw      provider output (parsed JSON, untrusted)
 * @param context  the context the model was given
 * @param refs     { "P1": placeId, … } from buildAssistantContext
 * @param allowSuggestions  only for suggest_adjustments on the current itinerary version
 * @returns { answer, truncated, places: [{ id, name }], suggestions, dropped } | null
 */
export function parseAssistantOutput(raw, { context, refs, allowSuggestions, config }) {
  if (!isPlainObject(raw) || typeof raw.answer !== 'string') return null;
  const cat = catalogue(context);

  // Places the reply talks about: listed by the model or mentioned in its text, known only.
  const listed = Array.isArray(raw.places) ? raw.places.filter((ref) => typeof ref === 'string') : [];
  const mentioned = raw.answer.match(REF) ?? [];
  const placeRefs = [...new Set([...listed, ...mentioned])].filter((ref) => cat.names.has(ref));
  const unknownRefs = [...new Set([...listed, ...mentioned])].length - placeRefs.length;

  // Names instead of reference codes in the text the traveller reads.
  const named = raw.answer.replace(REF, (ref) => cat.names.get(ref) ?? ref).trim();
  if (named === '') return null;
  const answer = truncate(named, config.maxAnswerChars);

  const rawSuggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const valid = allowSuggestions ? rawSuggestions.filter((s) => validSuggestion(s, cat)).slice(0, config.maxSuggestions) : [];
  const suggestions = valid.map((s) => ({
    type: s.type,
    ...(s.place !== undefined && { placeId: refs[s.place], placeName: cat.names.get(s.place) }),
    ...(s.dayNumber !== undefined && { dayNumber: s.dayNumber }),
    ...(s.type === 'MOVE_STOP' && { targetDayNumber: s.targetDayNumber }),
    rationale: truncate(s.rationale.replace(REF, (ref) => cat.names.get(ref) ?? ref).trim(), config.maxRationaleChars).text,
  }));

  return {
    answer: answer.text,
    truncated: answer.truncated,
    places: placeRefs.map((ref) => ({ id: refs[ref], name: cat.names.get(ref) })),
    suggestions,
    dropped: { unknownPlaces: unknownRefs, suggestions: rawSuggestions.length - suggestions.length },
  };
}
