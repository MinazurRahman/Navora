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

    async updateMe(req, res) {
      sendSuccess(res, { user: await authService.updateProfile(req.user.id, req.validated.body) });
    },

    async changePassword(req, res) {
      sendSuccess(res, await authService.changePassword(req.user.id, req.validated.body));
    },

    // 202 whether or not the email is registered.
    async forgotPassword(req, res) {
      await authService.requestPasswordReset(req.validated.body);
      res.status(202).json({ success: true, data: { requested: true } });
    },

    async resetPassword(req, res) {
      await authService.resetPassword(req.validated.body);
      sendSuccess(res, { reset: true });
    },
  };
}
