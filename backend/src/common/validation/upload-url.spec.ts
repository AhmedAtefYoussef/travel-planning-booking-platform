import { validateSync } from 'class-validator';
import { IsImageUrl, localUploadUrlPattern } from './upload-url';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

class Logo {
  @IsImageUrl('airlines', { message: 'bad logo' })
  logoUrl!: unknown;
}

const ok = (logoUrl: unknown) => {
  const logo = new Logo();
  logo.logoUrl = logoUrl;
  return validateSync(logo).length === 0;
};

describe('local upload URLs (GEN-08)', () => {
  it('matches only /uploads/<folder>/<uuid v4>.<jpg|png>', () => {
    const re = localUploadUrlPattern(['hotels', 'posts']);
    expect(re.exec(`/uploads/hotels/${ID}.png`)?.slice(1)).toEqual([
      'hotels',
      ID,
      'png',
    ]);
    expect(re.test(`/uploads/posts/${ID}.jpg`)).toBe(true);
    for (const url of [
      `/uploads/airlines/${ID}.png`,
      `/uploads/hotels/${ID}.gif`,
      `/uploads/hotels/${ID}.png?x=1`,
      `/uploads/hotels/../${ID}.png`,
      `/uploads/hotels/${ID.toUpperCase()}.png`,
      `/api/uploads/hotels/${ID}.png`,
      `/uploads/hotels/x/${ID}.png`,
    ]) {
      expect(re.test(url)).toBe(false);
    }
  });

  it('IsImageUrl accepts http(s) links and local URLs of its own folder only', () => {
    expect(ok('https://cdn.example.com/logo.png')).toBe(true);
    expect(ok('http://localhost:3000/logo.png')).toBe(true);
    expect(ok(`/uploads/airlines/${ID}.jpg`)).toBe(true);
    for (const bad of [
      `/uploads/hotels/${ID}.jpg`,
      '/uploads/a.png',
      'javascript:alert(1)',
      'ftp://cdn.example.com/a.png',
      'data:image/png;base64,iVBORw0KGgo=',
      42,
      null,
    ]) {
      expect(ok(bad)).toBe(false);
    }
  });
});
