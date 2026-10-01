// password_hash is never part of the default column set; only the credentials lookup reads it.
const PUBLIC_COLUMNS = ['id', 'name', 'email', 'role', 'profile_image_url', 'is_active', 'created_at', 'updated_at'];

export function createUsersRepository(db) {
  return {
    async create({ name, email, passwordHash }) {
      const [row] = await db('users')
        .insert({ name, email, password_hash: passwordHash })
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
  };
}
