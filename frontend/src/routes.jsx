import { AppShell } from './components/AppShell.jsx';
import { LoginPage, RegisterPage } from './features/auth/AuthPages.jsx';
import { RequireAuth } from './features/auth/RequireAuth.jsx';
import { ExplorePage } from './features/places/ExplorePage.jsx';
import { PlaceDetailPage } from './features/places/PlaceDetailPage.jsx';
import { SavedPlacesPage } from './features/saved/SavedPlacesPage.jsx';
import { PlanTripPage } from './features/trips/PlanTripPage.jsx';
import { TripsPage } from './features/trips/TripsPage.jsx';
import { ProfilePage } from './features/auth/ProfilePage.jsx';
import { TripPage } from './features/itineraries/TripPage.jsx';
import { CommunityPage } from './features/community/CommunityPage.jsx';
import { ModerationPage } from './features/community/ModerationPage.jsx';
import { MySubmissionsPage } from './features/community/MySubmissionsPage.jsx';
import { EditPlacePage, SubmitPlacePage } from './features/community/PlaceFormPages.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { NotFoundPage, RouteErrorPage } from './pages/StatusPages.jsx';
import { StyleGuidePage } from './pages/StyleGuidePage.jsx';

export const routes = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'explore', element: <ExplorePage /> },
      { path: 'places/:placeId', element: <PlaceDetailPage /> },
      { path: 'community', element: <CommunityPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'plan', element: <PlanTripPage /> },
          { path: 'saved', element: <SavedPlacesPage /> },
          { path: 'trips', element: <TripsPage /> },
          { path: 'trips/:tripId', element: <TripPage /> },
          { path: 'community/submit', element: <SubmitPlacePage /> },
          { path: 'community/mine', element: <MySubmissionsPage /> },
          { path: 'community/:placeId/edit', element: <EditPlacePage /> },
          { path: 'profile', element: <ProfilePage /> },
        ],
      },
      {
        element: <RequireAuth roles={['moderator', 'admin']} />,
        children: [{ path: 'moderation', element: <ModerationPage /> }],
      },
      ...(import.meta.env.DEV ? [{ path: 'style-guide', element: <StyleGuidePage /> }] : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
