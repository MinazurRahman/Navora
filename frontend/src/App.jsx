import { ToastProvider } from './components/Toast.jsx';
import { StyleGuidePage } from './pages/StyleGuidePage.jsx';

// Phase 2: only the design-system preview. Routing and the app shell arrive in Phase 3.
export function App() {
  return (
    <ToastProvider>
      <StyleGuidePage />
    </ToastProvider>
  );
}
