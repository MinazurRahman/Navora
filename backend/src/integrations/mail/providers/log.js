import { getLogger } from '../../../shared/logger.js';

// Development default: no mail leaves the machine. The message text (which can contain a
// reset link) goes to the server log so a developer can follow it; the recipient address
// does not. productionWarnings() flags this provider in production.
export function createLogMailProvider() {
  return {
    async send({ subject, text }) {
      getLogger().info({ mail: { subject, text } }, 'Mail not sent (MAIL_PROVIDER=log)');
    },
  };
}
