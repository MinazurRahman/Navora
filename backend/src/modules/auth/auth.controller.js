import { sendCreated, sendSuccess } from '../../shared/http/response.js';

export function createAuthController(authService) {
  return {
    async register(req, res) {
      sendCreated(res, await authService.register(req.validated.body));
    },

    async login(req, res) {
      sendSuccess(res, await authService.login(req.validated.body));
    },

    async refresh(req, res) {
      sendSuccess(res, await authService.refresh(req.validated.body));
    },

    async logout(req, res) {
      await authService.logout(req.validated.body);
      sendSuccess(res, { loggedOut: true });
    },

    async me(req, res) {
      sendSuccess(res, { user: await authService.getCurrentUser(req.user.id) });
    },
  };
}
