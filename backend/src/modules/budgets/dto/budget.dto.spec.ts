import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateBudgetEntryDto,
  CreateTransportCostDto,
  MAX_AMOUNT_MINOR,
  UpdateBudgetEntryDto,
  UpdateTransportCostDto,
} from './budget.dto';

const WHOLE = 'amountMinor must be a whole number of minor units';
const NEGATIVE = 'amountMinor must not be negative';
const TOO_LARGE = `amountMinor must not be greater than ${MAX_AMOUNT_MINOR}`;

/** Every message the validators report for amountMinor alone. */
const amountErrors = (dto: new () => object, amountMinor: unknown) =>
  validateSync(plainToInstance(dto, { amountMinor }))
    .filter((e) => e.property === 'amountMinor')
    .flatMap((e) => Object.values(e.constraints ?? {}));

/** ITN-14 / ITN-16 (GEN-02): one clear message per invalid amount, never a pile of them. */
describe('budget amounts (ITN-14, ITN-16)', () => {
  const dtos = [
    CreateBudgetEntryDto,
    UpdateBudgetEntryDto,
    CreateTransportCostDto,
    UpdateTransportCostDto,
  ];

  describe.each(dtos.map((dto) => [dto.name, dto] as const))('%s', (_, dto) => {
    it.each([
      [null, WHOLE],
      ['5', WHOLE],
      [1.5, WHOLE],
      [Number.NaN, WHOLE],
      [Number.MAX_SAFE_INTEGER + 1, WHOLE],
      [-1, NEGATIVE],
      [MAX_AMOUNT_MINOR + 1, TOO_LARGE],
    ])('amountMinor %p gives exactly one message', (value, message) => {
      expect(amountErrors(dto, value)).toEqual([message]);
    });

    it.each([0, 2550, MAX_AMOUNT_MINOR])('accepts %p', (value) => {
      expect(amountErrors(dto, value)).toEqual([]);
    });
  });

  it('still requires the amount when creating, and lets an edit leave it out', () => {
    expect(amountErrors(CreateBudgetEntryDto, undefined)).toEqual([WHOLE]);
    expect(amountErrors(CreateTransportCostDto, undefined)).toEqual([WHOLE]);
    expect(amountErrors(UpdateBudgetEntryDto, undefined)).toEqual([]);
    expect(amountErrors(UpdateTransportCostDto, undefined)).toEqual([]);
  });
});
