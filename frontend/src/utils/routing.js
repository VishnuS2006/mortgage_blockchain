export const USER_ROLES = {
  borrower: 'borrower',
  lender: 'lender',
};

export function getDefaultRouteForRole(role) {
  return role === USER_ROLES.lender ? '/lender/dashboard' : '/borrower/dashboard';
}

export function getRoleBasePath(role) {
  return role === USER_ROLES.lender ? '/lender' : '/borrower';
}

export function getLegacyBorrowerRedirect(pathname = '/') {
  const paramsIndex = pathname.indexOf('?');
  const search = paramsIndex >= 0 ? pathname.slice(paramsIndex) : '';
  const cleanPath = paramsIndex >= 0 ? pathname.slice(0, paramsIndex) : pathname;

  const map = {
    '/dashboard': '/borrower/dashboard',
    '/upload-property': '/borrower/upload-property',
    '/apply-loan': '/borrower/apply-loan',
    '/payment': '/borrower/payment',
  };

  return `${map[cleanPath] || '/borrower/dashboard'}${search}`;
}
