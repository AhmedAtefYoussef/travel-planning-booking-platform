import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsWholeNumber, Omittable } from '../../../common/validation';
import { MAX_REVIEW_TEXT } from '../schemas/review.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** HTL-23: one rating (1-5) and an optional review per Completed reservation. */
export class CreateReviewDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsWholeNumber('rating must be a whole number from 1 to 5')
  @Min(1, { message: 'rating must be a whole number from 1 to 5' })
  @Max(5, { message: 'rating must be a whole number from 1 to 5' })
  rating!: number;

  @ApiPropertyOptional({
    example: 'Great view of the Nile and a friendly front desk.',
    maxLength: MAX_REVIEW_TEXT,
    description: `Optional, at most ${MAX_REVIEW_TEXT} characters`,
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'text must be a string' })
  @MaxLength(MAX_REVIEW_TEXT, {
    message: `text must be at most ${MAX_REVIEW_TEXT} characters`,
  })
  text?: string;
}

/** HTL-23: the author edits the rating, the text, or both (send at least one). */
export class UpdateReviewDto {
  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @Omittable()
  @IsWholeNumber('rating must be a whole number from 1 to 5')
  @Min(1, { message: 'rating must be a whole number from 1 to 5' })
  @Max(5, { message: 'rating must be a whole number from 1 to 5' })
  rating?: number;

  @ApiPropertyOptional({
    example: 'Still great, but breakfast was slow.',
    maxLength: MAX_REVIEW_TEXT,
    description: `At most ${MAX_REVIEW_TEXT} characters; "" removes the text`,
  })
  @Omittable()
  @Transform(trim)
  @IsString({ message: 'text must be a string' })
  @MaxLength(MAX_REVIEW_TEXT, {
    message: `text must be at most ${MAX_REVIEW_TEXT} characters`,
  })
  text?: string;
}

/** HTL-26: a hotel moderator's reply to a review. */
export class ReplyToReviewDto {
  @ApiProperty({
    example: 'Thank you for staying with us, we are glad you enjoyed the view.',
    minLength: 1,
    maxLength: MAX_REVIEW_TEXT,
    description: `1 to ${MAX_REVIEW_TEXT} characters after trimming`,
  })
  @Transform(trim)
  @IsString({ message: 'text must be a string' })
  @IsNotEmpty({ message: 'text must not be empty' })
  @MaxLength(MAX_REVIEW_TEXT, {
    message: `text must be at most ${MAX_REVIEW_TEXT} characters`,
  })
  text!: string;
}

export class ReviewReplyDto {
  @ApiProperty({ example: 'Thank you for staying with us.' }) text!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ description: 'When the reply was last edited' })
  updatedAt!: Date;
}

export class ReviewAuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    example: 'Mona Adel',
    description: '"Deleted user" once the account is deactivated (ACC-12)',
  })
  name!: string;
}

/** A review as its author and the public see it. */
export class ReviewDto {
  @ApiProperty() id!: string;
  @ApiProperty() hotelId!: string;
  @ApiProperty() reservationId!: string;
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 }) rating!: number;
  @ApiProperty({ example: 'Great view of the Nile.' }) text!: string;
  @ApiProperty({ type: ReviewAuthorDto }) author!: ReviewAuthorDto;
  @ApiPropertyOptional({
    type: ReviewReplyDto,
    description: "The hotel's reply (HTL-26); absent until it answers",
  })
  reply?: ReviewReplyDto;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

/** HTL-24: the hotel's rating summary. */
export class HotelRatingDto {
  @ApiProperty({
    example: 4.3,
    description: 'Average of the visible ratings, one decimal; 0 when none',
  })
  ratingAvg!: number;
  @ApiProperty({ example: 27 }) ratingCount!: number;
}
