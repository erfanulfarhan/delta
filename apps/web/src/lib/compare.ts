export interface Comparison {
  /** The faster path's download over the slower one's. Zero without data. */
  ratio: number;
  rawFaster: boolean;
  heading: string;
  verdict: string;
}

/**
 * The comparison is the product. Neither speedtest.net nor speedtest.sg can
 * show it, because each only ever measures one path.
 *
 * Always "the faster one is N times the slower one", never a fraction.
 * "Local is faster by 0.8x" is not a sentence that means anything, and a
 * business line with generous IIG capacity really can be quicker abroad.
 */
export function compare(localDown: number, rawDown: number): Comparison {
  const rawFaster = rawDown > localDown;
  const faster = rawFaster ? rawDown : localDown;
  const slower = rawFaster ? localDown : rawDown;
  const ratio = slower > 0 ? faster / slower : 0;

  const verdict =
    ratio <= 0
      ? 'Not enough data to compare.'
      : ratio < 1.25
        ? 'Both paths are close. Your connection performs the same abroad as it does at home.'
        : rawFaster
          ? 'Your international path is the quicker one, which is unusual here and typical of a business line with generous IIG capacity.'
          : ratio >= 5
            ? 'Almost all of your speed is local. International traffic gets a fraction of it.'
            : 'Your local speed is meaningfully faster than your international speed.';

  return {
    ratio,
    rawFaster,
    heading: rawFaster ? 'Raw is faster by' : 'Local is faster by',
    verdict,
  };
}
