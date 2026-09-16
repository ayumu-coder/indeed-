#!/usr/bin/env python3
"""applied_rows.json から納品 CSV（7 列）と検品用のフル行 CSV を書き出す。"""
from __future__ import annotations
import csv, json, pathlib, re, sys

SCRATCH = pathlib.Path(__file__).resolve().parent
KEY_RE = re.compile(r'案件No[：:]\s*(\S+)')
OUT = SCRATCH / 'deliver'
OUT.mkdir(exist_ok=True)

def dump(table, path, encoding):
    with path.open('w', encoding=encoding, newline='') as f:
        csv.writer(f).writerows(table)

def main() -> int:
    before = json.loads((SCRATCH / 'all16_rows.json').read_text(encoding='utf-8'))
    after = json.loads((SCRATCH / 'applied_rows.json').read_text(encoding='utf-8'))
    hdr = after[0]
    assert before[0] == hdr, 'ヘッダーが一致しない'
    assert len(before) == len(after), '行数が一致しない'

    rows = [dict(zip(hdr, r)) for r in after[1:]]
    deliver = [['行番号', '案件No', '会社名', '職種名', 'キャッチコピー', '仕事内容', 'アピールポイント']]
    for i, r in enumerate(rows, start=2):
        m = KEY_RE.search(r['募集要項（仕事内容）'])
        deliver.append([i, m.group(1) if m else '', r['会社名'], r['職種名'],
                        r['求人キャッチコピー'], r['募集要項（仕事内容）'], r['募集要項（アピールポイント）']])
    dump(deliver, OUT / '全社_書き換え4列_20260916.csv', 'utf-8-sig')
    dump(before, OUT / '_before_full.csv', 'utf-8')
    dump(after, OUT / '_after_full.csv', 'utf-8')
    print(f'納品 CSV: {len(deliver)-1} 行')
    return 0

if __name__ == '__main__':
    sys.exit(main())
