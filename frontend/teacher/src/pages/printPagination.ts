export interface FlowUnit<T> {
  content: T;
  height: number;
  keepNext?: boolean;
  breakBefore?: boolean;
}

/** Fixed A4 columns, filled down the left then down the right. Never balance a long scroll. */
export function paginateFlow<T>(units: FlowUnit<T>[], pageHeight: number, headerHeight: number, columns = 2): T[][][] {
  const pages: T[][][] = [Array.from({ length: columns }, () => [])];
  let page = 0;
  let column = 0;
  let used = 0;
  const capacity = () => Math.max(0, pageHeight - (page === 0 ? headerHeight : 0));
  const advance = () => {
    column += 1;
    if (column === columns) {
      page += 1;
      column = 0;
      pages.push(Array.from({ length: columns }, () => []));
    }
    used = 0;
  };
  units.forEach((unit, index) => {
    if (unit.breakBefore && used > 0) advance();
    const required = unit.height + (unit.keepNext ? units[index + 1]?.height ?? 0 : 0);
    // An empty first-page column can be shorter than a whole question. Move past
    // both first-page columns when necessary; later pages have the full height.
    while (used + required > capacity() + 0.1 && (used > 0 || (page === 0 && required <= pageHeight))) advance();
    pages[page][column].push(unit.content);
    used += unit.height;
  });
  return pages;
}
