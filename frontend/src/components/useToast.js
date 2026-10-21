import { createContext, useContext } from 'react';

// Kept apart from Toast.jsx so that file exports only components (React fast refresh).
export const ToastContext = createContext(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
