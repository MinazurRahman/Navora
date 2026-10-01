import { ConflictError } from '../../shared/errors/AppError.js';

const UNIQUE_VIOLATION = '23505';

// Public surface of the users module. Other modules (auth, later reviews/trips) call this,
// never the users repository directly.
export function createUsersService({ usersRepository }) {
  return {
    // Relies on the unique constraint rather than check-then-insert, so two concurrent
    // registrations with the same email cannot both succeed.
    async createUser({ name, email, passwordHash }) {
      try {
        return await usersRepository.create({ name, email, passwordHash });
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION && err.constraint === 'users_email_key') {
          throw new ConflictError('An account with this email already exists', 'EMAIL_ALREADY_REGISTERED');
        }
        throw err;
      }
    },

    findById(id) {
      return usersRepository.findById(id);
    },

    findCredentialsByEmail(email) {
      return usersRepository.findCredentialsByEmail(email);
    },
  };
}
