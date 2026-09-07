import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** テロップ用の太いフォント。取得できなければ OS 同梱フォントにフォールバックする。 */
const FACES: readonly { readonly weight: number; readonly file: string }[] = [
  { weight: 900, file: 'NotoSansJP-900.ttf' },
  { weight: 700, file: 'NotoSansJP-700.ttf' },
];

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700;900&display=swap';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

async function fetchFaceUrls(): Promise<Map<number, string>> {
  const response = await fetch(GOOGLE_FONTS_CSS, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Google Fonts CSS の取得に失敗: ${response.status}`);
  const css = await response.text();
  const urls = new Map<number, string>();
  const blocks = css.split('@font-face');
  for (const block of blocks) {
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1];
    const url = block.match(/url\((https:[^)]+)\)/)?.[1];
    if (weight !== undefined && url !== undefined && !urls.has(Number(weight))) {
      urls.set(Number(weight), url);
    }
  }
  return urls;
}

/**
 * フォントをキャッシュディレクトリへ取得し、`@font-face` の CSS を返す。
 * ネットワークが無い環境では空文字を返し、呼び出し側は IPAGothic で描画する。
 */
export async function ensureFonts(cacheDir: string): Promise<string> {
  const dir = resolve(cacheDir);
  await mkdir(dir, { recursive: true });

  const missing = FACES.filter((face) => !existsSync(join(dir, face.file)));
  if (missing.length > 0) {
    try {
      const urls = await fetchFaceUrls();
      for (const face of missing) {
        const url = urls.get(face.weight);
        if (url === undefined) throw new Error(`weight ${face.weight} の URL が見つかりません`);
        const binary = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!binary.ok) throw new Error(`フォント取得に失敗: ${binary.status}`);
        await writeFile(join(dir, face.file), Buffer.from(await binary.arrayBuffer()));
      }
    } catch (error) {
      process.stderr.write(
        `[fonts] Noto Sans JP を取得できませんでした (${String(error)})。IPAGothic で描画します。\n`,
      );
      return '';
    }
  }

  // file:// のページから相対参照するより、data URI の方がパス解決の事故が無い。
  const faces = await Promise.all(
    FACES.map(async (face) => {
      const base64 = (await readFile(join(dir, face.file))).toString('base64');
      return `@font-face{font-family:'Noto Sans JP';font-style:normal;font-weight:${face.weight};`
        + `src:url(data:font/ttf;base64,${base64}) format('truetype');}`;
    }),
  );
  return faces.join('\n');
}
