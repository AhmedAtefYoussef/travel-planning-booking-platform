import {
  ModeratableContentType,
  type ModeratableContentAdapter,
} from '../../common/contracts';
import { ContentRegistryService } from './content-registry.service';

const adapter = (type: ModeratableContentType): ModeratableContentAdapter => ({
  type,
  find: jest.fn(),
  setHidden: jest.fn(),
  remove: jest.fn(),
});

describe('ContentRegistryService (GEN-10 port)', () => {
  it('returns the adapter registered for a type', () => {
    const registry = new ContentRegistryService();
    const posts = adapter(ModeratableContentType.Post);
    registry.register(posts);
    expect(registry.adapterFor(ModeratableContentType.Post)).toBe(posts);
  });

  it('returns undefined for a type no module registered', () => {
    const registry = new ContentRegistryService();
    registry.register(adapter(ModeratableContentType.Post));
    expect(registry.adapterFor(ModeratableContentType.Review)).toBeUndefined();
  });

  it('refuses a second adapter for the same type (a wiring defect)', () => {
    const registry = new ContentRegistryService();
    registry.register(adapter(ModeratableContentType.Comment));
    expect(() =>
      registry.register(adapter(ModeratableContentType.Comment)),
    ).toThrow(/COMMENT.*already registered/);
  });

  it('refuses an adapter whose type is not a moderatable content type', () => {
    const registry = new ContentRegistryService();
    expect(() =>
      registry.register(adapter('BLOG' as ModeratableContentType)),
    ).toThrow(/not a moderatable content type/);
  });
});
