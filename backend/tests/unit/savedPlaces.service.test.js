import { describe, expect, it } from 'vitest';
import { createSavedPlacesService } from '../../src/modules/savedPlaces/savedPlaces.service.js';

function fakes({ status = 'APPROVED', saved = [] } = {}) {
  const rows = new Set(saved);
  return {
    rows,
    savedPlacesRepository: {
      async save(_userId, placeId) {
        rows.add(placeId);
      },
      async remove(_userId, placeId) {
        rows.delete(placeId);
      },
      async isSaved(_userId, placeId) {
        return rows.has(placeId);
      },
      async countByUser() {
        return rows.size;
      },
    },
    placesService: {
      async getById(id) {
        return { id, status };
      },
    },
  };
}

const user = { id: 'u1', role: 'user' };

describe('saved places service', () => {
  it('refuses a new place once the limit is reached, but re-saving a saved one is fine', async () => {
    const { savedPlacesRepository, placesService, rows } = fakes({ saved: ['a'] });
    const service = createSavedPlacesService({ savedPlacesRepository, placesService, config: { maxPerUser: 1 } });

    await expect(service.save('a', user)).resolves.toEqual({ placeId: 'a', saved: true });
    await expect(service.save('b', user)).rejects.toMatchObject({ status: 409, code: 'SAVED_PLACES_LIMIT_REACHED' });
    expect([...rows]).toEqual(['a']);
  });

  it('refuses places that are not approved', async () => {
    const { savedPlacesRepository, placesService } = fakes({ status: 'PENDING' });
    const service = createSavedPlacesService({ savedPlacesRepository, placesService, config: { maxPerUser: 10 } });
    await expect(service.save('a', user)).rejects.toMatchObject({ status: 409, code: 'PLACE_NOT_SAVEABLE' });
  });
});
