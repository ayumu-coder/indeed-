# -*- coding: utf-8 -*-
"""納品 CSV（8 列、UTF-8 BOM 付き）を書き出す。"""
import csv, json, pathlib, re, sys
HERE = pathlib.Path(__file__).resolve().parent
KEY_RE = re.compile(r'案件No[：:]\s*(\S+)')
OUT = HERE / '1TF02_書き換え5列_20260917.csv'

def main() -> int:
    table = json.loads((HERE / 'applied_rows.json').read_text(encoding='utf-8'))
    hdr = table[0]
    rows = [dict(zip(hdr, r)) for r in table[1:]]
    body = [['行番号', '案件No', '会社名', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント', 'その他']]
    for i, r in enumerate(rows, start=2):
        m = KEY_RE.search(r['募集要項（仕事内容）'])
        body.append([i, m.group(1) if m else '', r['会社名'], r['求人キャッチコピー'], r['職種名'],
                     r['募集要項（仕事内容）'], r['募集要項（アピールポイント）'], r['募集要項（その他）']])
    with OUT.open('w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerows(body)
    print(f'納品 CSV: {len(body)-1} 行 / {OUT.name}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
