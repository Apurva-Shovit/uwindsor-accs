import React, { createContext, useContext, useState, useEffect } from 'react';
import { getMe } from '../lib/api';
import { clearToken, getToken, setToken } from '../lib/session';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string | null;
  status: string;
  assigned_tank_ids: string[];
}

interface AuthContextType {
  user: User | null;
  role: string | null;
  status: string | null;
  loading: boolean;
  loginToken: (token: string, role: string, status: string, remember: boolean) => Promise<void>;
  logout: () => void;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await getMe();
      setUser(res.data);
    } catch (err) {
      console.error('Failed to fetch me', err);
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const loginToken = async (token: string, _role: string, _status: string, remember: boolean) => {
    setToken(token, remember);
    await fetchCurrentUser();
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || null,
        status: user?.status || null,
        loading,
        loginToken,
        logout,
        refetchUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
