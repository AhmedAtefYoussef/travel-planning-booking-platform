import { parseIsoDate } from '../../common/utils/dates';

/** Shared Mongoose validators for the hotels collections. */

export const integer = {
  validator: (v: number) => v == null || Number.isInteger(v),
  message: '{PATH} must be an integer',
};

/** True for a real calendar date written YYYY-MM-DD. */
function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export const isoDate = {
  validator: (v: string) => v == null || isIsoDate(v),
  message: '{PATH} must be a calendar date YYYY-MM-DD',
};

/** Local wall-clock time "HH:mm", 00:00 to 23:59. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
