// password_hash is never part of the default column set; only the credentials lookup reads it.
const PUBLIC_COLUMNS = ['id', 'name', 'email', 'role', 'profile_image_url', 'is_active', 'created_at', 'updated_at'];

export function createUsersRepository(db) {
  return {
    // passwordHash is null for an account made through Google (googleSub set).
    async create({ name, email, passwordHash, googleSub = null }) {
      const [row] = await db('users')
        .insert({ name, email, password_hash: passwordHash, google_sub: googleSub })
        .returning(PUBLIC_COLUMNS);
      return row;
    },

    async findById(id) {
      return db('users').select(PUBLIC_COLUMNS).where({ id }).first();
    },

    // email is citext, so the comparison is case-insensitive.
    async findCredentialsByEmail(email) {
      return db('users').select([...PUBLIC_COLUMNS, 'password_hash']).where({ email }).first();
    },

    // For re-checking the password of a signed-in user (email or password change).
    async findCredentialsById(id) {
      return db('users').select([...PUBLIC_COLUMNS, 'password_hash']).where({ id }).first();
    },

    // fields: { name?, email? } — only the keys given are changed.
    async updateProfile(id, fields) {
      const [row] = await db('users').where({ id }).update(fields).returning(PUBLIC_COLUMNS);
      return row;
    },

    async findByGoogleSub(googleSub) {
      return db('users').select(PUBLIC_COLUMNS).where({ google_sub: googleSub }).first();
    },

    // Links a Google account to an existing account; only if none is linked yet. Returns
    // the user, or undefined when the account is already linked to another Google ID.
    async linkGoogle(id, googleSub) {
      const [row] = await db('users').where({ id }).whereNull('google_sub').update({ google_sub: googleSub }).returning(PUBLIC_COLUMNS);
      return row;
    },

    async updatePassword(id, passwordHash) {
      await db('users').where({ id }).update({ password_hash: passwordHash });
    },
  };
}
