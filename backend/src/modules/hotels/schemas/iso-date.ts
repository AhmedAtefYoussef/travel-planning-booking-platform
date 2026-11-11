import { parseIsoDate } from '../../../common/utils/dates';

/** Mongoose `validate` option: a real calendar date written YYYY-MM-DD (2027-02-30 is refused). */
export const isoDate = (field: string) => ({
  validator: (value: string) => {
    try {
      parseIsoDate(value);
      return true;
    } catch {
      return false;
    }
  },
  message: `${field} must be a calendar date YYYY-MM-DD`,
});
