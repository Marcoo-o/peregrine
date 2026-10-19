/**
 * The colours that tell accounts apart.
 *
 * The list used to live in the account editor, so only where it can be changed by hand. On
 * creation no colour was set at all and the column fell back to its default, with the result
 * that twelve accounts carried the **same** dot. A feature that is identical everywhere is
 * decoration.
 *
 * Six values, checked against both the light and the dark background and far enough apart in
 * hue to stay distinguishable side by side in an 8 pixel dot.
 */
export const ACCOUNT_COLORS = [
  '#2f5d9f',
  '#16736b',
  '#6341b8',
  '#a2650c',
  '#b03a5b',
  '#4a5568'
] as const

/**
 * The colour for a newly created account.
 *
 * Round robin rather than random. Random hands out two identical colours next to each other as
 * soon as there are more than a handful of accounts, and with six colours and twelve accounts
 * it is close to certain. Round robin is the only assignment guaranteed to differ for the
 * first six and to repeat evenly after that.
 *
 * `existingCount` is the number of accounts that already exist rather than their highest sort
 * order. Someone who deletes an account and creates a new one gets the freed colour back
 * instead of a gap in the series.
 */
export function nextAccountColor(existingCount: number): string {
  return ACCOUNT_COLORS[existingCount % ACCOUNT_COLORS.length]
}
