import { sendCreated, sendSuccess } from '../../shared/http/response.js';

export function createPlacesController(placesService) {
  const sendPage = (res, { places, meta }) => sendSuccess(res, places, { meta });

  return {
    async list(req, res) {
      sendPage(res, await placesService.list(req.validated.query));
    },

    async nearby(req, res) {
      sendPage(res, await placesService.nearby(req.validated.query));
    },

    async search(req, res) {
      sendPage(res, await placesService.search(req.validated.query));
    },

    async get(req, res) {
      sendSuccess(res, await placesService.getById(req.validated.params.id, req.user));
    },

    async create(req, res) {
      sendCreated(res, await placesService.create(req.validated.body, req.user));
    },

    async update(req, res) {
      sendSuccess(res, await placesService.update(req.validated.params.id, req.validated.body, req.user));
    },

    async archive(req, res) {
      sendSuccess(res, await placesService.archive(req.validated.params.id, req.user));
    },
  };
}
