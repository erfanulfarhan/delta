export type Route =
  | { name: 'home' }
  | { name: 'shared'; id: string }
  | { name: 'leaderboard' };

/**
 * Two extra routes do not justify a router dependency.
 *
 * Vercel rewrites both paths to index.html, so the app just reads the path once
 * on load and listens for history changes.
 */
export function parseRoute(pathname: string): Route {
  const shared = /^\/r\/([0-9a-z]{8,32})\/?$/.exec(pathname);
  if (shared) return { name: 'shared', id: shared[1]! };
  if (/^\/leaderboard\/?$/.test(pathname)) return { name: 'leaderboard' };
  return { name: 'home' };
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
