import { createContext, useContext } from 'react';

// Kept apart from AuthProvider.jsx so that file exports only components (React fast refresh).
export const AuthContext = createContext(null);

// { status: 'loading' | 'authenticated' | 'anonymous', user, signOut }
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
