import { RouterProvider, createBrowserRouter } from 'react-router';
import { ToastProvider } from './components/Toast.jsx';
import { AuthProvider } from './features/auth/AuthProvider.jsx';
import { routes } from './routes.jsx';

const router = createBrowserRouter(routes);

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
