const toNumberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

// API shape of a place. pg returns numeric columns as strings; convert them here.
export function toPlaceDto(row) {
  const dto = {
    id: row.id,
    name: row.name,
    description: row.description,
    category: { slug: row.category_slug, name: row.category_name },
    location: { latitude: row.latitude, longitude: row.longitude },
    address: row.address,
    city: row.city,
    entryFee: toNumberOrNull(row.entry_fee),
    currency: row.currency,
    typicalVisitMinutes: row.typical_visit_minutes,
    tags: row.tags,
    // [] = opening hours unknown
    openingHours: row.opening_hours,
    facilities: {
      parking: row.parking_available,
      petFriendly: row.pet_friendly,
      wheelchairAccessible: row.wheelchair_accessible,
      accessibilityNotes: row.accessibility_notes,
      restrictions: row.restrictions,
      verifiedAt: row.facilities_verified_at,
    },
    // Shown with its credit (author, license, source), which the photo's license requires.
    image: row.image_url
      ? { url: row.image_url, author: row.image_author, license: row.image_license, licenseUrl: row.image_license_url, sourceUrl: row.image_source_url }
      : null,
    rating: { average: toNumberOrNull(row.avg_rating), count: row.review_count },
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.distance_m !== undefined) dto.distanceMeters = Math.round(row.distance_m);
  return dto;
}
