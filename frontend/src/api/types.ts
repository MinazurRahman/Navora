// Types for the Navora API, written from backend/docs/openapi.yaml (the authoritative contract).
// When the contract changes, update these types in the same pull request.
// Possible next step: generate them instead with `openapi-typescript` (see SETUP.md).

export type FacilityStatus = 'YES' | 'NO' | 'UNKNOWN';
export type PlaceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
export type TravelMode = 'car' | 'walking' | 'cycling' | 'public_transport';
export type Role = 'user' | 'moderator' | 'admin';

export interface Location {
  latitude: number;
  longitude: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  profileImageUrl: string | null;
  createdAt: string;
}

export interface Tokens {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface Session {
  user: User;
  tokens: Tokens;
}

export interface Category {
  slug: string;
  name: string;
  description: string | null;
}

export interface Tag {
  slug: string;
  name: string;
}

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface OpeningHours {
  dayOfWeek: number; // ISO weekday, 1 = Monday
  opensAt: string; // "HH:MM"
  closesAt: string;
}

export interface Place {
  id: string;
  name: string;
  description: string | null;
  category: CategoryRef;
  location: Location;
  address: string | null;
  city: string | null;
  /** null = unknown, 0 = free */
  entryFee: number | null;
  currency: string;
  typicalVisitMinutes: number | null;
  tags: string[];
  /** [] = unknown (never assumed open) */
  openingHours: OpeningHours[];
  facilities: {
    parking: FacilityStatus;
    petFriendly: FacilityStatus;
    wheelchairAccessible: FacilityStatus;
    accessibilityNotes: string | null;
    restrictions: string | null;
    verifiedAt: string | null;
  };
  rating: { average: number | null; count: number };
  status: PlaceStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Only in nearby results and recommendations. */
  distanceMeters?: number;
}

export interface PlaceInput {
  name?: string;
  description?: string | null;
  category?: string;
  location?: Location;
  address?: string | null;
  city?: string | null;
  entryFee?: number | null;
  typicalVisitMinutes?: number | null;
  parkingAvailable?: FacilityStatus;
  petFriendly?: FacilityStatus;
  wheelchairAccessible?: FacilityStatus;
  accessibilityNotes?: string | null;
  restrictions?: string | null;
  tags?: string[];
  openingHours?: OpeningHours[];
}

export interface ModerationEvent {
  action: 'SUBMITTED' | 'EDITED' | 'RESUBMITTED' | 'APPROVED' | 'REJECTED' | 'ARCHIVED' | 'RESTORED';
  fromStatus: PlaceStatus | null;
  toStatus: PlaceStatus;
  note: string | null;
  createdAt: string;
}

export interface Review {
  id: string;
  placeId: string;
  rating: number;
  comment: string | null;
  author: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  amount: number;
  type: 'total' | 'per_day';
}

export interface RecommendationRequest {
  location: Location;
  searchRadiusKm?: number;
  interests?: string[];
  preferredCategories?: string[];
  budget?: Budget;
  durationDays?: number;
  startDate?: string;
  dailyStartTime?: string;
  dailyEndTime?: string;
  travelingWithPet?: boolean;
  parkingRequired?: boolean;
  wheelchairAccessRequired?: boolean;
  minimumRating?: number;
  limit?: number;
}

export interface Recommendation {
  place: Place;
  score: number;
  breakdown: Partial<Record<'interest' | 'category' | 'proximity' | 'budget' | 'rating' | 'popularity' | 'schedule', number>>;
  reasons: string[];
  warnings: string[];
}

export interface RecommendationMeta {
  startDate: string;
  durationDays: number;
  searchRadiusKm: number;
  candidatesInRadius: number;
  candidatesConsidered: number;
  eligible: number;
  returned: number;
  excludedBy: Record<string, number>;
  suggestions: string[];
}

export interface Trip {
  id: string;
  title: string;
  startLocation: Location;
  startAddress: string | null;
  /** null = plans start "today" (Asia/Dhaka) */
  startDate: string | null;
  durationDays: number;
  dailyStartTime: string;
  dailyEndTime: string;
  searchRadiusKm: number;
  budget: (Budget & { currency: string }) | null;
  travelMode: TravelMode;
  travelingWithPet: boolean;
  parkingRequired: boolean;
  wheelchairAccessRequired: boolean;
  partySize: number;
  minimumRating: number | null;
  interests: string[];
  preferredCategories: string[];
  selectedPlaceIds: string[];
  currentItineraryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripInput {
  title?: string;
  startLocation?: Location;
  startAddress?: string | null;
  startDate?: string | null;
  durationDays?: number;
  dailyStartTime?: string;
  dailyEndTime?: string;
  searchRadiusKm?: number;
  budget?: Budget | null;
  travelMode?: TravelMode;
  travelingWithPet?: boolean;
  parkingRequired?: boolean;
  wheelchairAccessRequired?: boolean;
  partySize?: number;
  minimumRating?: number | null;
  interests?: string[];
  preferredCategories?: string[];
  selectedPlaceIds?: string[];
}

export type WarningCode =
  | 'TRAVEL_TIMES_ESTIMATED'
  | 'START_DATE_ASSUMED'
  | 'OPENING_HOURS_UNVERIFIED'
  | 'ENTRY_FEE_UNKNOWN'
  | 'STOP_REMOVED_AFTER_ROUTING';

export interface ItineraryWarning {
  code: WarningCode;
  message: string;
  placeId?: string;
  dayNumber?: number;
}

export interface StopPlace {
  id: string;
  name: string;
  category: CategoryRef;
  location: Location;
}

export interface Leg {
  minutes: number;
  distanceMeters: number;
}

export interface ItineraryStop {
  order: number;
  place: StopPlace;
  plannedStart: string;
  plannedEnd: string;
  visitMinutes: number;
  travelFromPrevious: Leg;
  estimatedCost: number | null;
  openingHoursVerified: boolean;
}

export interface ItineraryDay {
  dayNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  totals: { distanceMeters: number; travelMinutes: number; visitMinutes: number; plannedMinutes: number };
  /** Encoded polyline (precision 5); null without real routing data. */
  routePolyline: string | null;
  stops: ItineraryStop[];
}

export interface Itinerary {
  id: string;
  tripId: string;
  version: number;
  isCurrent: boolean;
  userModified: boolean;
  routing: { provider: string; algorithm: string; travelTimesEstimated: boolean };
  totals: {
    distanceMeters: number;
    travelMinutes: number;
    visitMinutes: number;
    plannedMinutes: number;
    estimatedCost: number | null;
    currency: string;
  };
  days: ItineraryDay[];
  warnings: ItineraryWarning[];
  generatedFrom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ItinerarySummary {
  id: string;
  tripId: string;
  tripTitle: string;
  version: number;
  isCurrent: boolean;
  userModified: boolean;
  dayCount: number;
  stopCount: number;
  totals: {
    distanceMeters: number;
    travelMinutes: number;
    visitMinutes: number;
    estimatedCost: number | null;
    currency: string;
  };
  travelTimesEstimated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItineraryEditDay {
  dayNumber: number;
  placeIds: string[];
  optimizeOrder?: boolean;
}

export interface Deleted {
  id: string;
  deleted: true;
}
