/**
 * Megabits per second with as many decimals as the size of the figure earns.
 *
 * Two decimals on 873 claims a precision no network test has, and the extra
 * digits were the busiest thing on the screen. Under 10 Mbps they still matter.
 */
export const formatMbps = (n: number): string =>
  n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

export const formatMs = (n: number, decimals = 0): string => n.toFixed(decimals);
