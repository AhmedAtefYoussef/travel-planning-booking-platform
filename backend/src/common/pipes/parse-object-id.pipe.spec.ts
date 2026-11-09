import { BadRequestException } from '@nestjs/common';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('passes a valid 24-hex id through', () => {
    expect(pipe.transform('507f1f77bcf86cd799439011')).toBe(
      '507f1f77bcf86cd799439011',
    );
  });

  it.each(['abc', '', '507f1f77bcf86cd79943901', '507f1f77bcf86cd79943901z'])(
    'rejects %p with 400',
    (bad) => {
      expect(() => pipe.transform(bad)).toThrow(BadRequestException);
    },
  );
});
