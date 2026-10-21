export type Route =
  | { name: 'home' }
  | { name: 'shared'; id: string }
  | { name: 'leaderboard' }
  | { name: 'privacy' };

/**
 * Three extra routes do not justify a router dependency.
 *
 * The host serves index.html for these paths (Cloudflare Pages does it for any
 * unknown path, vercel.json rewrites them), so the app just reads the path once
 * on load and listens for history changes.
 */
export function parseRoute(pathname: string): Route {
  const shared = /^\/r\/([0-9a-z]{8,32})\/?$/.exec(pathname);
  if (shared) return { name: 'shared', id: shared[1]! };
  if (/^\/leaderboard\/?$/.test(pathname)) return { name: 'leaderboard' };
  if (/^\/privacy\/?$/.test(pathname)) return { name: 'privacy' };
  return { name: 'home' };
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
