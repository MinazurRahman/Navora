export function createPasswordResetTokenRepository(db) {
  return {
    async create({ userId, tokenHash, expiresAt }) {
      await db('password_reset_tokens').insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
    },

    // Marks the token used if it is unused and unexpired, returning its user_id; otherwise
    // undefined. A single conditional UPDATE, so a link cannot be used twice concurrently.
    async claim(tokenHash) {
      const [row] = await db('password_reset_tokens')
        .where({ token_hash: tokenHash })
        .whereNull('used_at')
        .where('expires_at', '>', db.fn.now())
        .update({ used_at: db.fn.now() })
        .returning(['user_id']);
      return row;
    },

    // Before a new link is sent and after a reset: only the newest link ever works.
    async deleteForUser(userId) {
      await db('password_reset_tokens').where({ user_id: userId }).delete();
    },
  };
}
