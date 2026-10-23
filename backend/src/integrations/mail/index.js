import { createLogMailProvider } from './providers/log.js';

// Provider-neutral mail: send({ to, subject, text }) resolves when the message is accepted.
// Adding a provider (SMTP, an email API) = one adapter in providers/ + one case here.
export function createMailServiceFromConfig(config) {
  switch (config.mail.provider) {
    case 'log':
      return createLogMailProvider();
    default:
      throw new Error(`Unknown MAIL_PROVIDER: ${config.mail.provider}`);
  }
}
