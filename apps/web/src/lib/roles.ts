/**
 * Role groupings and the landing page each role gets.
 *
 * The manager-plus list was previously copy-pasted at every call site, which is
 * how the root URL ended up disagreeing with the login form about where a
 * signed-in user belongs. Anything deciding "admin side or staff side" should
 * use these rather than inlining the array again.
 */
export const MANAGER_PLUS_ROLES = ['super_admin', 'chair', 'admin', 'manager'];

export const ALL_ROLES = ['staff', ...MANAGER_PLUS_ROLES];

export const isManagerPlus = (role?: string | null): boolean =>
  !!role && MANAGER_PLUS_ROLES.includes(role);

/** Where a signed-in user should land. AdminLayout forwards /admin to its dashboard. */
export const homePathForRole = (role?: string | null): string =>
  isManagerPlus(role) ? '/admin' : '/staff/tanks';
