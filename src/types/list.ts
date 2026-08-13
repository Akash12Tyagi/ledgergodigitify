/**
 * What a date-scoped list holds OUTSIDE the window it is currently showing.
 *
 * Computed only when the windowed query came back empty, so the table can
 * say why it is empty. "Nothing recorded yet" and "nothing in these dates"
 * render identically otherwise, and a backdated entry — recorded today,
 * dated three months ago — lands squarely in the second while looking
 * exactly like the first, i.e. like the save silently failed.
 */
export type OutsideWindowSummary = {
  /** Rows every filter EXCEPT the date window matches. */
  total: number;
  /** IST "YYYY-MM-DD" bounds of those rows, for "jump to them" actions. */
  earliest: string;
  latest: string;
};
