import { sendSuccess } from '../../shared/http/response.js';

export function createHealthController(healthService) {
  return {
    getHealth(req, res) {
      sendSuccess(res, healthService.getLiveness());
    },

    async getReady(req, res) {
      sendSuccess(res, await healthService.assertReady());
    },
  };
}
