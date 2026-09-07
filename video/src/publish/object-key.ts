import { createHash } from 'node:crypto';

/**
 * 保存先のキー。日付で分割し、内容のハッシュを付けて衝突と上書きを避ける。
 * 同じ動画を再投稿しても同じキーになるため、無駄なアップロードを検出できる。
 */
export function buildObjectKey(id: string, content: Buffer, at: Date): string {
  const date = at.toISOString().slice(0, 10);
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 8);
  return `shorts/${date}/${id}-${digest}.mp4`;
}
