import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setToken, getToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await get('/auth/me');
      setUser(res.user);
      setSettings(res.settings || {});
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onUnauthorised = () => setUser(null);
    window.addEventListener('brightloop:unauthorised', onUnauthorised);
    return () => window.removeEventListener('brightloop:unauthorised', onUnauthorised);
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await post('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
    // Settings are a nicety — never let them fail an otherwise good sign-in.
    try {
      const me = await get('/auth/me');
      setSettings(me.settings || {});
    } catch { /* keep defaults */ }
    return res.user;
  }, []);

  const signup = useCallback(async (payload) => {
    const res = await post('/auth/signup', payload);
    setToken(res.token);
    setUser(res.user);
    try {
      const me = await get('/auth/me');
      setSettings(me.settings || {});
    } catch { /* keep defaults */ }
    return res.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    settings,
    loading,
    login,
    signup,
    logout,
    refresh,
    setSettings,
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'staff',
    isCustomer: user?.role === 'customer',
    canManage: user?.role === 'admin' || user?.role === 'staff',
  }), [user, settings, loading, login, signup, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
