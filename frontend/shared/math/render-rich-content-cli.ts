import { stdin as input, stdout, stderr } from 'node:process';
import { createInterface } from 'node:readline';
import {
  renderRichContent,
  renderRichContentStrict,
  type RenderedRichContent,
} from './renderRichContent';

interface RenderRichContentCliItem {
  id: string;
  text?: string;
  imagePaths?: string[];
  rendererVersion?: string;
}

interface RenderRichContentCliRequest {
  items?: RenderRichContentCliItem[];
  strict?: boolean;
}

interface RenderRichContentCliResponseItem {
  id: string;
  rendered: RenderedRichContent;
}

function printHelp(): void {
  stdout.write(
    [
      'Usage: npm run render-rich-content -- [--help]',
      '',
      'Reads JSON from stdin:',
      '{"items":[{"id":"q1:stem","text":"由 $v=at$ 可得","imagePaths":[]}],"strict":false}',
      '',
      'Writes JSON to stdout:',
      '{"items":[{"id":"q1:stem","rendered":{...}}]}',
      '',
    ].join('\n'),
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function renderPayload(payload: RenderRichContentCliRequest) {
  const render = payload.strict ? renderRichContentStrict : renderRichContent;
  const items: RenderRichContentCliResponseItem[] = (payload.items || []).map((item) => ({
    id: item.id,
    rendered: render({
      text: item.text || '',
      imagePaths: item.imagePaths || [],
      rendererVersion: item.rendererVersion,
    }),
  }));
  return { items };
}

async function runServer(): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      const payload = JSON.parse(line || '{}') as RenderRichContentCliRequest;
      stdout.write(`${JSON.stringify(renderPayload(payload))}\n`);
    } catch (error) {
      stdout.write(`${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      })}\n`);
    }
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }
  if (process.argv.includes('--server')) {
    await runServer();
    return;
  }

  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput || '{}') as RenderRichContentCliRequest;
  stdout.write(`${JSON.stringify(renderPayload(payload))}\n`);
}

main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
