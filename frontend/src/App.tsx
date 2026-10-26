import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { DiscoverPage } from './pages/DiscoverPage';
import { PlaceDetailPage } from './pages/PlaceDetailPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { PlannerPage } from './pages/PlannerPage';
import { TripsPage } from './pages/TripsPage';
import { TripPage } from './pages/TripPage';
import { ContributePage } from './pages/ContributePage';
import { MySubmissionsPage } from './pages/MySubmissionsPage';
import { ModerationPage } from './pages/ModerationPage';
import { AccountPage } from './pages/AccountPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DiscoverPage />} />
        <Route path="places/:id" element={<PlaceDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        {/* Planning works signed out until "Generate" (trips belong to an account). */}
        <Route path="plan" element={<PlannerPage />} />
        <Route path="trips" element={<RequireAuth><TripsPage /></RequireAuth>} />
        <Route path="trips/:id" element={<RequireAuth><TripPage /></RequireAuth>} />
        <Route path="trips/:id/edit" element={<RequireAuth><PlannerPage /></RequireAuth>} />
        <Route path="contribute" element={<RequireAuth><ContributePage /></RequireAuth>} />
        <Route path="contribute/:id" element={<RequireAuth><ContributePage /></RequireAuth>} />
        <Route path="my-places" element={<RequireAuth><MySubmissionsPage /></RequireAuth>} />
        <Route path="moderation" element={<RequireAuth moderator><ModerationPage /></RequireAuth>} />
        <Route path="account" element={<RequireAuth><AccountPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
