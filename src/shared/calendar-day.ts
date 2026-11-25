/**
 * A real calendar day written YYYY-MM-DD, such as an expected ship date (google-backorder-ship-date-20261124).
 * "2027-02-31" is refused: the date it parses to is a different day.
 */
export const isCalendarDay = (value: unknown): value is string =>
  typeof value === "string" && value.length === 10 && !!new Date(value).toJSON()?.startsWith(value);
