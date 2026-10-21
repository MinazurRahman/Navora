import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { ToastProvider } from './components/Toast.jsx';
import { AuthProvider } from './features/auth/AuthProvider.jsx';
import { createQueryClient } from './lib/queryClient.js';
import { routes } from './routes.jsx';

const router = createBrowserRouter(routes);

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
