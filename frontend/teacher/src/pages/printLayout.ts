/** Keep complex/multiple diagrams in their original order. Only one standalone figure may wrap. */
export function splitPrintFigure(text: string): { text: string; token: string } | null {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$)/);
  const matches = parts.flatMap((part, index) => index % 2 ? [] : [...part.matchAll(/\{\{IMG:\d+\}\}/g)]);
  if (matches.length !== 1 || /^\s*\|.*\|\s*$/m.test(text)) return null;
  const token = matches[0][0];
  return { token, text: parts.map((part, index) => index % 2 ? part : part.replace(token, '')).join('').trim() };
}

export function smallPrintFigure(width: number, height: number): boolean {
  // Pixel counts describe resolution, not printed size: the same diagram may be
  // scanned at 300 or 600 dpi. Panoramas/tall diagrams keep their own centered row.
  return width > 0 && height > 0 && width / height >= 0.75 && width / height <= 1.8;
}

/** Logical lines may continue on the next teacher-reference page. Keep display
 * math and Markdown tables together instead of cutting their internal newlines. */
export function printTextBlocks(text: string): string[] {
  const protectedParts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/);
  const lines = [''];
  protectedParts.forEach((part, index) => {
    if (index % 2) { lines[lines.length - 1] += part; return; }
    part.split('\n').forEach((line, lineIndex) => {
      if (lineIndex) lines.push(line);
      else lines[lines.length - 1] += line;
    });
  });
  const blocks: string[] = [];
  let table = false;
  lines.forEach((line) => {
    const tableLine = /^\s*\|/.test(line);
    if (tableLine && table) blocks[blocks.length - 1] += '\n' + line;
    else blocks.push(line || '\u3000');
    table = tableLine;
  });
  return blocks;
}
