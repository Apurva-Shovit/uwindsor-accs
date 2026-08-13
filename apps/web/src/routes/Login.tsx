import React, { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { login } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../lib/roles';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Opt-in by default: a remembered session gets a 30-day token, and there is
  // no server-side revocation if a device is lost.
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { loginToken, user, loading: authLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login({ email, password, remember_me: rememberMe });
      const { access_token, role, status } = res.data;
      await loginToken(access_token, role, status, rememberMe);

      navigate(homePathForRole(role));
    } catch (err: any) {
      if (err.response?.status === 403 && err.response?.data?.detail?.includes('pending')) {
        navigate('/pending-approval');
        return;
      }
      setError(err.response?.data?.detail || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  // Someone with a live session reaching the form directly (a bookmark, or the
  // browser restoring tabs) should go to their dashboard rather than be asked
  // to sign in again.
  if (!authLoading && user && user.status === 'active') {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md border border-border space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brandBlue text-white text-xl font-bold">
            AC
          </div>
          <h1 className="mt-3 text-2xl font-bold text-textPrimary">Sign In to ACare</h1>
          <p className="mt-1 text-sm text-textSecondary">Aquatic System Control & Approval Portal</p>
        </div>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm font-medium text-danger">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-textPrimary">Email address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
              placeholder="user@uwindsor.ca"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-textPrimary">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-border text-brandBlue accent-brandBlue focus:outline-none focus:ring-2 focus:ring-brandBlue/40"
            />
            <span className="text-sm text-textPrimary">Keep me signed in</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brandBlue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brandBlueDark disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="text-center text-sm text-textSecondary">
          Don't have an account?{' '}
          <Link to="/signup" className="font-semibold text-brandBlue hover:underline">
            Request Access
          </Link>
        </div>
      </div>
    </div>
  );
};
