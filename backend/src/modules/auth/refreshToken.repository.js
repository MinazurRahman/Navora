const COLUMNS = ['id', 'user_id', 'family_id', 'expires_at', 'revoked_at'];

export function createRefreshTokenRepository(db) {
  return {
    async create({ userId, familyId, tokenHash, expiresAt }) {
      const [row] = await db('refresh_tokens')
        .insert({ user_id: userId, family_id: familyId, token_hash: tokenHash, expires_at: expiresAt })
        .returning(['id']);
      return row;
    },

    // Atomically revokes the token if it is still active and returns it; returns
    // undefined if it is unknown or already revoked. A single conditional UPDATE, so two
    // concurrent refreshes with the same token cannot both succeed.
    async claim(tokenHash) {
      const [row] = await db('refresh_tokens')
        .where({ token_hash: tokenHash })
        .whereNull('revoked_at')
        .update({ revoked_at: db.fn.now() })
        .returning(COLUMNS);
      return row;
    },

    async findByHash(tokenHash) {
      return db('refresh_tokens').select(COLUMNS).where({ token_hash: tokenHash }).first();
    },

    async setReplacedBy(id, replacedById) {
      await db('refresh_tokens').where({ id }).update({ replaced_by_id: replacedById });
    },

    async revokeFamily(familyId) {
      await db('refresh_tokens')
        .where({ family_id: familyId })
        .whereNull('revoked_at')
        .update({ revoked_at: db.fn.now() });
    },
  };
}
