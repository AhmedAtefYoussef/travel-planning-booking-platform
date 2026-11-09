import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateAirlineDto } from './airline.dto';

const fields = (body: object) =>
  validateSync(plainToInstance(UpdateAirlineDto, body)).map((e) => e.property);

describe('UpdateAirlineDto (FLT-01)', () => {
  it('lets every field be left out', () => {
    expect(fields({})).toEqual([]);
    expect(fields({ name: 'EgyptAir Express' })).toEqual([]);
  });

  it('rejects null for name and code', () => {
    expect(fields({ name: null, code: null }).sort()).toEqual(['code', 'name']);
  });

  it('accepts null for logoUrl (removes the logo) but still validates a sent URL', () => {
    expect(fields({ logoUrl: null })).toEqual([]);
    expect(fields({ logoUrl: 'not a url' })).toEqual(['logoUrl']);
  });
});
