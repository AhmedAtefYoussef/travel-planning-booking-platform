import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Rejects anything that is not a 24-hex ObjectId with 400. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (
      typeof value !== 'string' ||
      !OBJECT_ID.test(value) ||
      !isValidObjectId(value)
    ) {
      throw new BadRequestException('Invalid id');
    }
    return value;
  }
}
