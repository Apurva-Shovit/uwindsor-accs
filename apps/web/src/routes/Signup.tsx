import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signup } from '../lib/api';

export const Signup: React.FC = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requestedRole, setRequestedRole] = useState('staff');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signup({
        first_name: firstName,
        last_name: lastName,
        email,
        password,
        requested_role: requestedRole,
      });
      navigate('/pending-approval');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to submit registration request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md border border-border space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brandBlue text-white text-xl font-bold">
            AC
          </div>
          <h1 className="mt-3 text-2xl font-bold text-textPrimary">Request Account Access</h1>
          <p className="mt-1 text-sm text-textSecondary">Submit your request for ACare system approval</p>
        </div>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm font-medium text-danger">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-textPrimary">First Name</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-textPrimary">Last Name</label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
              />
            </div>
          </div>

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

          <div>
            <label className="block text-sm font-medium text-textPrimary">Requested Role</label>
            <select
              value={requestedRole}
              onChange={(e) => setRequestedRole(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-brandBlue focus:outline-none"
            >
              <option value="chair">Chair</option>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brandBlue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brandBlueDark disabled:opacity-50"
          >
            {loading ? 'Submitting Request...' : 'Submit Access Request'}
          </button>
        </form>

        <div className="text-center text-sm text-textSecondary">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-brandBlue hover:underline">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};
