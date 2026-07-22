/**
 * Canonical public app URLs.
 *
 * All auth-email / invite / webhook redirect targets must be pinned to the
 * PRODUCTION base URL — never derived from `window.location.origin` at the
 * call site, because that can capture:
 *   - the Lovable editor preview host (id-preview--*.lovable.app)
 *   - the sandbox preview host
 *   - a share-preview URL
 * If the invite email links to any of those, the link routes through
 * Lovable's platform auth bridge instead of the app itself.
 *
 * When a custom domain is attached later, update PROD_BASE_URL here (one
 * place) and everything downstream follows.
 */
export const PROD_BASE_URL = 'https://trophi-client-hub.lovable.app';

export const ACCEPT_INVITE_URL = `${PROD_BASE_URL}/accept-invite`;
export const RESET_PASSWORD_URL = `${PROD_BASE_URL}/reset-password`;
export const AUTH_CALLBACK_URL = `${PROD_BASE_URL}/auth`;
