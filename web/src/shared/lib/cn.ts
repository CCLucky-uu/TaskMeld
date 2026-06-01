/**
 * Lightweight CSS classname merging utility.
 * Filters out falsy values and joins with space.
 * Replaces scattered `${a} ${b}` manual string concatenation.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
