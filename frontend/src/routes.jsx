import { AppShell } from './components/AppShell.jsx';
import { LoginPage, RegisterPage } from './features/auth/AuthPages.jsx';
import { RequireAuth } from './features/auth/RequireAuth.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { NotFoundPage, PlaceholderPage, RouteErrorPage } from './pages/StatusPages.jsx';
import { StyleGuidePage } from './pages/StyleGuidePage.jsx';

// Pages that are not built yet render a PlaceholderPage; each is replaced in its phase.
const soon = (title, description) => <PlaceholderPage title={title} description={description} />;

export const routes = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'explore', element: soon('Explore', 'Search and filter approved places in Dhaka.') },
      { path: 'places/:placeId', element: soon('Place details', 'Details, opening hours and reviews.') },
      { path: 'community', element: soon('Community', 'Recently added places from the community.') },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'plan', element: soon('Plan a trip', 'Set your preferences and generate an itinerary.') },
          { path: 'trips', element: soon('My trips', 'Your saved trips and itineraries.') },
          { path: 'trips/:tripId', element: soon('Itinerary', 'Day-by-day stops, route and AI assistant.') },
          { path: 'community/submit', element: soon('Submit a place', 'Suggest a place for moderators to review.') },
          { path: 'community/mine', element: soon('My submissions', 'Places you submitted and their status.') },
          { path: 'community/:placeId/edit', element: soon('Edit submission', 'Edit a pending or rejected place.') },
          { path: 'profile', element: soon('Profile', 'Your account details.') },
        ],
      },
      {
        element: <RequireAuth roles={['moderator', 'admin']} />,
        children: [{ path: 'moderation', element: soon('Moderation', 'Review submitted places.') }],
      },
      ...(import.meta.env.DEV ? [{ path: 'style-guide', element: <StyleGuidePage /> }] : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
