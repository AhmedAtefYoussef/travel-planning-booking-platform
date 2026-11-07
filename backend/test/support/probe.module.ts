/**
 * Test-only module that exercises the common layer end to end through real HTTP and a real
 * (in-memory) MongoDB: validation, fieldErrors, pagination, duplicate keys, bad ids, 404 and 500.
 * It is mounted only by e2e tests, never by AppModule.
 */
import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  InjectModel,
  MongooseModule,
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEmail,
  IsISO8601,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Model } from 'mongoose';
import {
  paginate,
  PaginationQueryDto,
} from '../../src/common/pagination/pagination';
import { ParseObjectIdPipe } from '../../src/common/pipes/parse-object-id.pipe';
import { Public } from '../../src/common/auth/auth.decorators';

@Schema({ collection: 'probe_items', timestamps: true })
class ProbeItem {
  @Prop({ required: true }) name!: string;
  @Prop({ required: true, unique: true }) email!: string;
}
const ProbeItemSchema = SchemaFactory.createForClass(ProbeItem);

class PassengerDto {
  @IsString() @Length(1, 100) fullName!: string;
  @IsISO8601({ strict: true }) dob!: string;
}

class CreateProbeDto {
  @IsString() @Length(2, 50) name!: string;
  @IsEmail() email!: string;
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  @ArrayMinSize(1)
  passengers!: PassengerDto[];
}

// Public: these routes test validation/errors/pagination, not authentication.
@Public()
@Controller('__probe')
class ProbeController {
  constructor(
    @InjectModel(ProbeItem.name) private readonly model: Model<ProbeItem>,
  ) {}

  @Post('items')
  async create(@Body() dto: CreateProbeDto) {
    const doc = await this.model.create({ name: dto.name, email: dto.email });
    return { id: doc.id as string };
  }

  @Get('items')
  list(@Query() query: PaginationQueryDto) {
    return paginate(this.model, {}, query.page, { sort: { name: 1 } });
  }

  @Get('items/:id')
  async get(@Param('id', ParseObjectIdPipe) id: string) {
    const item = await this.model.findById(id).lean().exec();
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  @Get('cast/:id')
  cast(@Param('id') id: string) {
    return this.model.findById(id).exec();
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProbeItem.name, schema: ProbeItemSchema },
    ]),
  ],
  controllers: [ProbeController],
})
export class ProbeModule {
  static readonly model = ProbeItem.name;
}
