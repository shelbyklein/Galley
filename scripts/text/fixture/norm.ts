/** Text normalisation used on both sides of the screen-vs-PDF comparison. */
export const normText = (s: string) => s.normalize('NFKC').replace(/[‐‑­‒−]/g, '-');
