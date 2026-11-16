/**
 * Test-only content module for the moderation e2e suite (GEN-09, GEN-10). It stands in for the posts
 * and comments modules, which are not built yet: one throwaway collection, one adapter per type,
 * registered through the real CONTENT_MODERATION_REGISTRY exactly as a content module will. REVIEW and
 * ITINERARY stay unregistered. Mounted only by e2e tests, never by AppModule.
 */
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import {
  InjectModel,
  MongooseModule,
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
import {
  ClientSession,
  Model,
  Schema as MongooseSchema,
  Types,
} from 'mongoose';
import {
  CONTENT_MODERATION_REGISTRY,
  ModeratableContentType,
  type ContentModerationRegistry,
  type ModeratableContent,
  type ModeratableContentAdapter,
} from '../../src/common/contracts';

@Schema({ collection: 'moderation_test_items' })
export class TestContent {
  @Prop({ type: String, required: true })
  kind!: ModeratableContentType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  authorId!: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  hidden!: boolean;
}
const TestContentSchema = SchemaFactory.createForClass(TestContent);

class TestContentAdapter implements ModeratableContentAdapter {
  constructor(
    readonly type: ModeratableContentType,
    private readonly model: Model<TestContent>,
  ) {}

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    const doc = await this.model
      .findOne({ _id: id, kind: this.type })
      .session(session ?? null)
      .lean();
    return doc
      ? { ownerId: doc.authorId.toHexString(), hidden: doc.hidden }
      : null;
  }

  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id, kind: this.type },
      { $set: { hidden } },
      { session },
    );
  }

  async remove(id: string, session: ClientSession): Promise<void> {
    await this.model.deleteOne({ _id: id, kind: this.type }, { session });
  }
}

export const REGISTERED_TEST_TYPES = [
  ModeratableContentType.Post,
  ModeratableContentType.Comment,
];

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TestContent.name, schema: TestContentSchema },
    ]),
  ],
})
export class TestContentModule implements OnModuleInit {
  constructor(
    @InjectModel(TestContent.name) private readonly model: Model<TestContent>,
    @Inject(CONTENT_MODERATION_REGISTRY)
    private readonly registry: ContentModerationRegistry,
  ) {}

  onModuleInit(): void {
    for (const type of REGISTERED_TEST_TYPES) {
      this.registry.register(new TestContentAdapter(type, this.model));
    }
  }
}
