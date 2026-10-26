import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useTripDraft } from '../trip/tripDraft';
import { useServerSlow } from '../api/serverStatus';

export function Layout() {
  const { user, isModerator, logout } = useAuth();
  const draft = useTripDraft();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const serverSlow = useServerSlow();

  const close = () => setMenuOpen(false);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand" onClick={close}>
          <svg viewBox="0 0 32 32" aria-hidden className="brand__mark">
            <path d="M5 22c4-1 5-11 10-11s6 9 12 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <circle cx="5" cy="22" r="3" />
            <circle cx="27" cy="19" r="3" />
          </svg>
          Navora
        </Link>

        <button
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>

        <nav id="primary-nav" className={`nav ${menuOpen ? 'nav--open' : ''}`} aria-label="Main">
          <NavLink to="/" end onClick={close}>
            Discover
          </NavLink>
          <NavLink to="/plan" onClick={close}>
            Plan a trip
            {draft.length > 0 && <span className="count" aria-label={`${draft.length} places picked`}>{draft.length}</span>}
          </NavLink>
          {user && (
            <>
              <NavLink to="/trips" onClick={close}>
                My trips
              </NavLink>
              <NavLink to="/contribute" onClick={close}>
                Add a place
              </NavLink>
            </>
          )}
          {isModerator && (
            <NavLink to="/moderation" onClick={close}>
              Moderation
            </NavLink>
          )}
          <span className="nav__spacer" />
          {user ? (
            <>
              <NavLink to="/account" onClick={close} className="nav__account">
                {user.name}
              </NavLink>
              <button
                className="btn btn--ghost btn--small"
                onClick={async () => {
                  close();
                  await logout();
                  navigate('/');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" onClick={close}>
                Sign in
              </NavLink>
              <Link to="/register" className="btn btn--primary btn--small" onClick={close}>
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      {serverSlow && (
        <p className="waking" role="status">
          Still working. If Navora has not been used for a while, its server takes up to a minute to start.
        </p>
      )}

      <main id="main" className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <p>
          Navora shows only what the data says: facilities, fees and opening hours marked Unknown have not been
          confirmed.
        </p>
      </footer>
    </div>
  );
}
