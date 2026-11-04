// Split a list into fixed-size pages (the Sports tile shows 3 games per page).
// ≤3 games → a single page (the tile stays static — no breadcrumb, no swipe);
// >3 → ceil(n/3) pages, each a swipeable panel with one breadcrumb dot. Pure so
// the page math is unit-tested without rendering the self-fetching component.
export function paginateGames<T>(games: T[], perPage = 3): T[][] {
  const size = Math.max(1, perPage);
  const pages: T[][] = [];
  for (let i = 0; i < games.length; i += size) pages.push(games.slice(i, i + size));
  return pages;
}
