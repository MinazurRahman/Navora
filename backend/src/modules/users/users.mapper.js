// The only way a user leaves the API. Explicit allow-list: new columns (and the
// password hash) are never exposed by accident.
export function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    profileImageUrl: row.profile_image_url ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
