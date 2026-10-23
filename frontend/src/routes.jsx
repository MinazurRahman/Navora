import { AppShell } from './components/AppShell.jsx';
import { PageLoading } from './components/PageLoading.jsx';
import { RequireAuth } from './features/auth/RequireAuth.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { NotFoundPage, RouteErrorPage } from './pages/StatusPages.jsx';

// Pages load on demand (one chunk each) so the first visit downloads only the shell and the
// home page. `page(load, name)` builds React Router's lazy route from a named export.
const page = (load, name) => async () => ({ Component: (await load())[name] });

export const routes = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    // Shown on a first visit straight to a lazy page while its chunk downloads.
    hydrateFallbackElement: <PageLoading label="Loading NAVORA" />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'explore', lazy: page(() => import('./features/places/ExplorePage.jsx'), 'ExplorePage') },
      { path: 'places/:placeId', lazy: page(() => import('./features/places/PlaceDetailPage.jsx'), 'PlaceDetailPage') },
      { path: 'community', lazy: page(() => import('./features/community/CommunityPage.jsx'), 'CommunityPage') },
      { path: 'login', lazy: page(() => import('./features/auth/AuthPages.jsx'), 'LoginPage') },
      { path: 'register', lazy: page(() => import('./features/auth/AuthPages.jsx'), 'RegisterPage') },
      { path: 'forgot-password', lazy: page(() => import('./features/auth/AuthPages.jsx'), 'ForgotPasswordPage') },
      { path: 'reset-password', lazy: page(() => import('./features/auth/AuthPages.jsx'), 'ResetPasswordPage') },
      {
        element: <RequireAuth />,
        children: [
          { path: 'plan', lazy: page(() => import('./features/trips/PlanTripPage.jsx'), 'PlanTripPage') },
          { path: 'saved', lazy: page(() => import('./features/saved/SavedPlacesPage.jsx'), 'SavedPlacesPage') },
          { path: 'trips', lazy: page(() => import('./features/trips/TripsPage.jsx'), 'TripsPage') },
          { path: 'trips/:tripId', lazy: page(() => import('./features/itineraries/TripPage.jsx'), 'TripPage') },
          { path: 'community/submit', lazy: page(() => import('./features/community/PlaceFormPages.jsx'), 'SubmitPlacePage') },
          { path: 'community/mine', lazy: page(() => import('./features/community/MySubmissionsPage.jsx'), 'MySubmissionsPage') },
          { path: 'community/:placeId/edit', lazy: page(() => import('./features/community/PlaceFormPages.jsx'), 'EditPlacePage') },
          { path: 'profile', lazy: page(() => import('./features/auth/ProfilePage.jsx'), 'ProfilePage') },
        ],
      },
      {
        element: <RequireAuth roles={['moderator', 'admin']} />,
        children: [{ path: 'moderation', lazy: page(() => import('./features/community/ModerationPage.jsx'), 'ModerationPage') }],
      },
      ...(import.meta.env.DEV ? [{ path: 'style-guide', lazy: page(() => import('./pages/StyleGuidePage.jsx'), 'StyleGuidePage') }] : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
