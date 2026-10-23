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

    // Housekeeping without a scheduled job: expired tokens of one user (uses the user_id
    // index). Revoked-but-unexpired tokens stay: reuse detection needs them.
    async deleteExpiredForUser(userId) {
      await db('refresh_tokens').where({ user_id: userId }).where('expires_at', '<', db.fn.now()).delete();
    },

    // Every session of the user (after a password change or reset).
    async revokeAllForUser(userId) {
      await db('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: db.fn.now() });
    },

    async revokeFamily(familyId) {
      await db('refresh_tokens')
        .where({ family_id: familyId })
        .whereNull('revoked_at')
        .update({ revoked_at: db.fn.now() });
    },
  };
}
