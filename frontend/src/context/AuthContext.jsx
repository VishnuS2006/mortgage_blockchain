import { createContext, useContext, useEffect, useState } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    ...user,
    role: user.role || 'borrower',
    walletAddress: user.walletAddress ?? user.wallet_address ?? null,
    createdAt: user.createdAt ?? user.created_at ?? null,
  };
}

function getStoredUser() {
  try {
    return normalizeUser(JSON.parse(localStorage.getItem('user') || 'null'));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(getStoredUser);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('token')));

  const persistAuth = (nextToken, nextUser) => {
    const normalizedUser = normalizeUser(nextUser);
    localStorage.setItem('token', nextToken);
    localStorage.setItem('user', JSON.stringify(normalizedUser));
    setToken(nextToken);
    setUser(normalizedUser);
    return normalizedUser;
  };

  const clearAuth = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    let isActive = true;

    if (!token) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    api.get('/auth/me')
      .then((res) => {
        if (!isActive) {
          return;
        }

        const normalizedUser = normalizeUser(res.data.user);
        setUser(normalizedUser);
        localStorage.setItem('user', JSON.stringify(normalizedUser));
      })
      .catch(() => {
        if (isActive) {
          clearAuth();
        }
      })
      .finally(() => {
        if (isActive) {
          setLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [token]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    return persistAuth(res.data.token, res.data.user);
  };

  const signup = async ({ name, email, password, role, walletAddress, walletSignature }) => {
    const res = await api.post('/auth/register', {
      name,
      email,
      password,
      role,
      walletAddress,
      walletSignature,
    });

    return persistAuth(res.data.token, res.data.user);
  };

  const logout = () => {
    clearAuth();
  };

  const refreshUser = async () => {
    const res = await api.get('/auth/me');
    const normalizedUser = normalizeUser(res.data.user);
    setUser(normalizedUser);
    localStorage.setItem('user', JSON.stringify(normalizedUser));
    return normalizedUser;
  };

  const linkWallet = async (walletAddress, walletSignature) => {
    const res = await api.post('/auth/link-wallet', { walletAddress, walletSignature });
    const normalizedUser = normalizeUser(res.data.user);
    setUser(normalizedUser);
    localStorage.setItem('user', JSON.stringify(normalizedUser));
    return normalizedUser;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: Boolean(user),
        login,
        signup,
        logout,
        refreshUser,
        linkWallet,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
