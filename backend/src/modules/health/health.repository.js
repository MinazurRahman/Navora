export function createHealthRepository(db) {
  return {
    async ping() {
      await db.raw('select 1');
    },
  };
}
