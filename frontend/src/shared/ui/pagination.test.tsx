import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pagination, pageItems } from '@/shared/ui/pagination';

describe('pageItems', () => {
  it.each([
    [1, 1, [1]],
    [1, 2, [1, 2]],
    [1, 5, [1, 2, 'ellipsis', 5]],
    [3, 5, [1, 2, 3, 4, 5]],
    [1, 4, [1, 2, 3, 4]],
    [2, 4, [1, 2, 3, 4]],
    [5, 10, [1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]],
    [1, 10, [1, 2, 'ellipsis', 10]],
    [10, 10, [1, 'ellipsis', 9, 10]],
    [3, 10, [1, 2, 3, 4, 'ellipsis', 10]],
    [8, 10, [1, 'ellipsis', 7, 8, 9, 10]],
    [0, 3, [1, 2, 3]],
    [99, 3, [1, 2, 3]],
  ] as const)('page %i of %i', (page, total, expected) => {
    expect(pageItems(page, total)).toEqual(expected);
  });

  it('returns nothing without pages', () => {
    expect(pageItems(1, 0)).toEqual([]);
  });
});

describe('Pagination', () => {
  const hrefFor = (p: number) => `/items?page=${p}`;

  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} hrefFor={hrefFor} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the current page and disables Previous on page 1', () => {
    render(<Pagination page={1} totalPages={5} hrefFor={hrefFor} />);
    expect(
      screen.getByRole('navigation', { name: 'Pagination' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Page 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Page 2' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(
      screen.queryByRole('link', { name: /Previous/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Previous').closest('span')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/items?page=2',
    );
  });

  it('disables Next on the last page', () => {
    render(<Pagination page={5} totalPages={5} hrefFor={hrefFor} />);
    expect(
      screen.queryByRole('link', { name: /Next/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Previous/ })).toHaveAttribute(
      'href',
      '/items?page=4',
    );
  });
});
