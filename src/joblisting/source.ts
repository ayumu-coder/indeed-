import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';

/** A source document (求人票 PDF, a photo of a printout, a memo) ready to send to the model. */
export interface SourceDocument {
  readonly name: string;
  readonly block: Anthropic.ContentBlockParam;
}

export class SourceError extends Error {}

/** Well under the API's 32 MB request cap, leaving room for several files plus the prompt. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

const IMAGE_MEDIA_TYPES: ReadonlyMap<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> =
  new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
  ]);

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.txt', '.md', '.csv', '.tsv', '.json']);

export function supportedExtensions(): readonly string[] {
  return ['.pdf', ...IMAGE_MEDIA_TYPES.keys(), ...TEXT_EXTENSIONS];
}

function blockFor(path: string, bytes: Buffer): Anthropic.ContentBlockParam {
  const extension = extname(path).toLowerCase();
  const name = basename(path);

  if (extension === '.pdf') {
    return {
      type: 'document',
      title: name,
      source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
    };
  }

  const mediaType = IMAGE_MEDIA_TYPES.get(extension);
  if (mediaType !== undefined) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') },
    };
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return { type: 'text', text: `<source name="${name}">\n${bytes.toString('utf8')}\n</source>` };
  }

  throw new SourceError(
    `Unsupported file type "${extension}" for ${name}. Supported: ${supportedExtensions().join(', ')}`,
  );
}

export async function loadSource(path: string): Promise<SourceDocument> {
  const bytes = await readFile(path);
  if (bytes.length > MAX_FILE_BYTES) {
    throw new SourceError(
      `${basename(path)} is ${bytes.length} bytes, over the ${MAX_FILE_BYTES}-byte per-file limit`,
    );
  }
  return { name: basename(path), block: blockFor(path, bytes) };
}

/** Loads every source, refusing the batch rather than sending a request the API would reject. */
export async function loadSources(paths: readonly string[]): Promise<readonly SourceDocument[]> {
  const documents = await Promise.all(paths.map(loadSource));
  const total = documents.reduce((sum, document) => sum + approximateBytes(document.block), 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new SourceError(
      `Sources total roughly ${total} bytes, over the ${MAX_TOTAL_BYTES}-byte request limit. Split them across runs.`,
    );
  }
  return documents;
}

function approximateBytes(block: Anthropic.ContentBlockParam): number {
  if (block.type === 'text') return Buffer.byteLength(block.text, 'utf8');
  if (block.type === 'image' && block.source.type === 'base64') return block.source.data.length;
  if (block.type === 'document' && block.source.type === 'base64') return block.source.data.length;
  return 0;
}
