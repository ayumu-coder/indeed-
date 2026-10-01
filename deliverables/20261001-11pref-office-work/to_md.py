# -*- coding: utf-8 -*-
"""納品 CSV を 1 行 1 md に展開して lint_posting.py を通すためのブリッジ。

lint_posting.py は md 原稿を見る。会社名・給与などの列はこの納品物が持たないので、
出てくる required / wage 系の検出はその欠落によるもの。
見たいのは gender / age / copy-wage / title-word / bullet-spacing / duplicate。
"""
import csv, pathlib, shutil, sys

SRC = pathlib.Path('11都道府県トップ5駅_事務職求人_20261001.csv')
DST = pathlib.Path('_md')


def main() -> int:
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir()
    with SRC.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    for i, r in enumerate(rows, start=1):
        md = '\n'.join([
            f'# {r["タイトル"]}', '',
            '## 職種名', '', r['タイトル'], '',
            '## キャッチコピー', '', r['キャッチコピー'], '',
            '## 仕事内容', '', r['仕事内容'], '',
            '## アピールポイント', '', r['アピールポイント'], '',
        ])
        (DST / f'{i:02d}_{r["駅名"].replace("・", "-")}.md').write_text(md, encoding='utf-8')
    print(f'{len(rows)} 件を md に展開した: {DST}/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
