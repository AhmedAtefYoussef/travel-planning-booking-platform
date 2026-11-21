import { mapPage, PAGE_SIZE, pageOf, skipFor } from './pagination';

describe('pagination helpers', () => {
  const rows = Array.from({ length: 23 }, (_, i) => i + 1);

  it('skipFor treats anything below 1 as the first page', () => {
    expect(skipFor(0)).toBe(0);
    expect(skipFor(1)).toBe(0);
    expect(skipFor(3)).toBe(2 * PAGE_SIZE);
  });

  it('pageOf returns one page of an in-memory list in the GEN-05 envelope', () => {
    expect(pageOf(rows, 3)).toEqual({
      items: [21, 22, 23],
      page: 3,
      limit: PAGE_SIZE,
      total: 23,
      totalPages: 3,
    });
    expect(pageOf(rows, 4).items).toEqual([]);
    expect(pageOf([], 1)).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('mapPage converts the items and keeps the page fields', () => {
    const page = mapPage(pageOf(rows, 1), (n) => `row ${n}`);
    expect(page.items[0]).toBe('row 1');
    expect(page).toMatchObject({ page: 1, total: 23, totalPages: 3 });
  });
});
