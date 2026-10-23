import { ConflictError } from '../../shared/errors/AppError.js';

const UNIQUE_VIOLATION = '23505';

// Public surface of the users module. Other modules (auth, later reviews/trips) call this,
// never the users repository directly.
export function createUsersService({ usersRepository }) {
  return {
    // Relies on the unique constraint rather than check-then-insert, so two concurrent
    // registrations with the same email cannot both succeed.
    async createUser({ name, email, passwordHash, googleSub }) {
      try {
        return await usersRepository.create({ name, email, passwordHash, googleSub });
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

    findCredentialsById(id) {
      return usersRepository.findCredentialsById(id);
    },

    findByGoogleSub(googleSub) {
      return usersRepository.findByGoogleSub(googleSub);
    },

    linkGoogle(id, googleSub) {
      return usersRepository.linkGoogle(id, googleSub);
    },

    // Same unique-constraint rule as createUser: a taken email is a 409, never a race.
    async updateProfile(id, fields) {
      try {
        return await usersRepository.updateProfile(id, fields);
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION && err.constraint === 'users_email_key') {
          throw new ConflictError('An account with this email already exists', 'EMAIL_ALREADY_REGISTERED');
        }
        throw err;
      }
    },

    updatePassword(id, passwordHash) {
      return usersRepository.updatePassword(id, passwordHash);
    },
  };
}
