// npm run set-role -- <email> <role>   (role: user | moderator | admin)
// Changes an existing account's role, for example to make someone a moderator. Uses the
// database in DATABASE_URL, so it works the same against a local or a production database.
// The change takes effect when the person's access token next refreshes (within
// JWT_ACCESS_TOKEN_TTL_SECONDS) or when they sign in again.
import { env } from '../src/config/env.js';
import { createDb } from '../src/config/database.js';
import { ROLES } from '../src/shared/auth/authorization.js';

const [email, role] = process.argv.slice(2);
const roles = Object.values(ROLES);
if (!email || !roles.includes(role)) {
  console.error(`Usage: npm run set-role -- <email> <${roles.join(' | ')}>`);
  process.exit(1);
}

const db = createDb(env);
try {
  // email is citext: the match ignores case.
  const [user] = await db('users').where({ email: email.trim() }).update({ role }).returning(['id', 'name', 'role']);
  if (!user) {
    console.error('No account uses that email. The person must register first.');
    process.exitCode = 1;
  } else {
    console.log(`${user.name} is now ${user.role}. They get the new role after signing in again (or within a few minutes).`);
  }
} finally {
  await db.destroy();
}
