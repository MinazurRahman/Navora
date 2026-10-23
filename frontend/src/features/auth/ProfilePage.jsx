import { Link, useNavigate } from 'react-router';
import { Bookmark, ChevronRight, ClipboardList, LogOut, Map as MapIcon, ShieldCheck } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button } from '../../components/Button.jsx';
import { Card } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { ChangePasswordForm, EditProfileForm } from './AccountForms.jsx';
import { useAuth } from './useAuth.js';
import styles from './ProfilePage.module.css';

const ROLE_LABELS = { user: 'Member', moderator: 'Moderator', admin: 'Administrator' };
const joinedFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'Asia/Dhaka' });

// The signed-in account, from GET /auth/me (verified when the app starts).
export function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const moderator = user.role === 'moderator' || user.role === 'admin';

  const links = [
    { to: '/trips', icon: MapIcon, label: 'My trips', text: 'Trips and their itineraries' },
    { to: '/saved', icon: Bookmark, label: 'Saved places', text: 'Places you want to visit' },
    { to: '/community/mine', icon: ClipboardList, label: 'My submissions', text: 'Places you suggested and their review status' },
    ...(moderator ? [{ to: '/moderation', icon: ShieldCheck, label: 'Moderation', text: 'Review community submissions' }] : []),
  ];

  return (
    <main className="container">
      <title>Profile | NAVORA</title>
      <PageHeader title="Profile" />

      <div className={styles.layout}>
        <div className={styles.column}>
          <Card>
            <dl className={styles.details}>
              <div>
                <dt>Name</dt>
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>
                  <Badge tone={moderator ? 'info' : 'neutral'}>{ROLE_LABELS[user.role] ?? user.role}</Badge>
                </dd>
              </div>
              {user.createdAt && (
                <div>
                  <dt>Member since</dt>
                  <dd>{joinedFormat.format(new Date(user.createdAt))}</dd>
                </div>
              )}
            </dl>
            <Button
              variant="secondary"
              icon={LogOut}
              onClick={async () => {
                await navigate('/');
                signOut();
              }}
            >
              Sign out
            </Button>
          </Card>
          <EditProfileForm key={`${user.name}|${user.email}`} user={user} />
          <ChangePasswordForm user={user} />
        </div>

        <nav aria-label="Your activity">
          <ul className={styles.links}>
            {links.map(({ to, icon: Icon, label, text }) => (
              <li key={to}>
                <Link to={to} className={styles.link}>
                  <span className={styles.linkIcon}>
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className={styles.linkText}>
                    <span className={styles.linkLabel}>{label}</span>
                    <span className={styles.linkHint}>{text}</span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" className={styles.chevron} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
