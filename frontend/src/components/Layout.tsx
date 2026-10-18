import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useTripDraft } from '../trip/tripDraft';

export function Layout() {
  const { user, isModerator, logout } = useAuth();
  const draft = useTripDraft();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const close = () => setMenuOpen(false);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
      
      </a>
      <header className="topbar">
        <Link to="/" className="brand" onClick={close}>
          <img style={{ width:40, height: 40 }} src="/NAVORA_NEW.png" alt="Navora" />
          NAVORA
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
