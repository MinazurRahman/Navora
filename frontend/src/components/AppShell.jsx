import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { CircleUser, LogOut, Menu, ShieldCheck, TriangleAlert, WifiOff, X } from 'lucide-react';
import { useAuth } from '../features/auth/useAuth.js';
import { useOnline } from '../lib/useOnline.js';
import { Button, IconButton } from './Button.jsx';
import { Logo } from './Logo.jsx';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { to: '/explore', label: 'Explore' },
  { to: '/plan', label: 'Plan a trip' },
  { to: '/community', label: 'Community' },
  { to: '/trips', label: 'My trips' },
  { to: '/saved', label: 'Saved' },
];

const isModerator = (user) => user?.role === 'moderator' || user?.role === 'admin';

function navClass({ isActive }) {
  return `${styles.navLink} ${isActive ? styles.active : ''}`;
}

function AccountActions({ onNavigate }) {
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();

  if (status === 'loading') return null;

  if (status === 'anonymous') {
    return (
      <>
        <Button as={Link} to="/login" variant="ghost" onClick={onNavigate}>
          Sign in
        </Button>
        <Button as={Link} to="/register" onClick={onNavigate}>
          Create account
        </Button>
      </>
    );
  }

  return (
    <>
      {isModerator(user) && (
        <NavLink to="/moderation" className={navClass} onClick={onNavigate}>
          <ShieldCheck size={16} aria-hidden="true" />
          Moderation
        </NavLink>
      )}
      <NavLink to="/profile" className={navClass} onClick={onNavigate}>
        <CircleUser size={16} aria-hidden="true" />
        <span className={styles.userName}>{user.name}</span>
      </NavLink>
      <Button
        variant="ghost"
        icon={LogOut}
        onClick={async () => {
          // Leave the page first: on a private page, signing out first would make the
          // route guard redirect to /login instead.
          await navigate('/');
          signOut();
        }}
      >
        Sign out
      </Button>
    </>
  );
}

function Header() {
  const { pathname } = useLocation();
  // The menu belongs to the page it was opened on, so any navigation closes it.
  const [openOn, setOpenOn] = useState(null);
  const menuOpen = openOn === pathname;
  const closeMenu = () => setOpenOn(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => event.key === 'Escape' && setOpenOn(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <Link to="/" className={styles.brand} aria-label="NAVORA home">
          <Logo />
        </Link>

        <nav className={styles.desktopNav} aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.desktopAccount}>
          <AccountActions />
        </div>

        <IconButton
          className={styles.menuButton}
          icon={menuOpen ? X : Menu}
          label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setOpenOn(menuOpen ? null : pathname)}
        />
      </div>

      {menuOpen && (
        <div id="mobile-menu" className={styles.mobileMenu}>
          <nav className={styles.mobileNav} aria-label="Main">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass} onClick={closeMenu}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className={styles.mobileAccount}>
            <AccountActions onNavigate={closeMenu} />
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <Logo />
          <p className="muted">Discover beyond the usual.</p>
        </div>
        <p className={styles.footerNote}>
          Places are contributed by the community and reviewed by moderators before they are listed.
        </p>
      </div>
    </footer>
  );
}

// Shown when the server ended the session (expired or revoked), so being signed out is
// never a silent surprise. The sign-in pages show their own notice instead.
function SessionEndedBanner() {
  const { sessionExpired, dismissSessionExpired } = useAuth();
  const { pathname, search } = useLocation();
  if (!sessionExpired || pathname === '/login' || pathname === '/register') return null;
  return (
    <div className={styles.banner} role="status">
      <div className={`container ${styles.bannerInner}`}>
        <TriangleAlert size={18} aria-hidden="true" className={styles.bannerIcon} />
        <p className={styles.bannerText}>
          Your session has ended.{' '}
          <Link to={`/login?next=${encodeURIComponent(pathname + search)}`}>Sign in again</Link> to continue.
        </p>
        <IconButton icon={X} size="sm" label="Dismiss" onClick={dismissSessionExpired} />
      </div>
    </div>
  );
}

function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div className={styles.banner} role="status">
      <div className={`container ${styles.bannerInner}`}>
        <WifiOff size={18} aria-hidden="true" className={styles.bannerIcon} />
        <p className={styles.bannerText}>
          You are offline. Pages you already opened still work; new information loads when you are back online.
        </p>
      </div>
    </div>
  );
}

export function AppShell() {
  const mainRef = useRef(null);
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  // After client-side navigation, move focus to the new page so screen readers announce it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <Header />
      <OfflineBanner />
      <SessionEndedBanner />
      <div id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <Outlet />
      </div>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
