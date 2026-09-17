# -*- coding: utf-8 -*-
"""9/16 の承認済み文面をこのシートの行に展開し、その他列を新規に入れる。

対象 5 列以外が 1 文字でも変わったら落ちる。案件No は元の本文から取り出して保持する。
"""
import csv, json, pathlib, re, sys
from collections import OrderedDict
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from other import OTHER

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent / 'out'          # 9/16 に作った会社ごとの文面（キャッチは v2）
TARGETS = ('求人キャッチコピー', '職種名', '募集要項（仕事内容）', '募集要項（アピールポイント）', '募集要項（その他）')
KEY_RE = re.compile(r'案件No[：:]\s*(\S+)')
SPEC_OF = {'大東建託株式会社': '09', 'タマホーム株式会社': '14'}


def area(address: str) -> str:
    parts = [p for p in re.split(r'[\s　]+', address.strip()) if p]
    return ''.join(parts[:-1]) if len(parts) > 2 else ''.join(parts)


def place(address: str) -> str:
    parts = [p for p in re.split(r'[\s　]+', address.strip()) if p]
    if len(parts) > 2:
        return ''.join(parts[1:-1])
    return parts[1] if len(parts) > 1 else parts[0]


def main() -> int:
    table = json.loads((HERE / 'tf02_rows.json').read_text(encoding='utf-8'))
    hdr = table[0]
    rows = [dict(zip(hdr, r)) for r in table[1:]]

    groups = OrderedDict()
    for i, r in enumerate(rows, start=2):
        groups.setdefault(r['会社名'], []).append((i, r))

    out, problems = [], []
    for comp, members in groups.items():
        spec = json.loads((SRC / f'{SPEC_OF[comp]}.json').read_text(encoding='utf-8'))
        pats = spec['job_body_patterns']
        for n, (i, r) in enumerate(members):
            m = KEY_RE.search(r['募集要項（仕事内容）'])
            if m is None:
                problems.append(f'行{i} {comp}: 案件No が元の本文にない')
                out.append((i, dict(r)))
                continue
            addr = r['勤務地（都道府県・市区町村・町域）']
            body = pats[n % len(pats)].replace('{{AREA}}', area(addr)).replace('{{NO}}', m.group(1))
            r2 = dict(r)
            r2['職種名'] = spec['job_title_template'].replace('{place}', place(addr))
            r2['求人キャッチコピー'] = spec['catch_copy']
            r2['募集要項（仕事内容）'] = body
            r2['募集要項（アピールポイント）'] = spec['appeal']
            r2['募集要項（その他）'] = OTHER[comp]
            if '{{' in body or '{place}' in r2['職種名']:
                problems.append(f'行{i} {comp}: 未置換のプレースホルダ')
            if KEY_RE.search(body).group(1) != m.group(1):
                problems.append(f'行{i} {comp}: 案件No が保持されていない')
            for col in hdr:
                if col not in TARGETS and r2[col] != r[col]:
                    problems.append(f'行{i} {comp}: 対象外の列 {col} が変化した')
            out.append((i, r2))

    out.sort(key=lambda x: x[0])
    (HERE / 'applied_rows.json').write_text(
        json.dumps([hdr] + [[r.get(h, '') for h in hdr] for _, r in out], ensure_ascii=False), encoding='utf-8')

    for name, table_ in (('_before_full.csv', table),
                         ('_after_full.csv', [hdr] + [[r.get(h, '') for h in hdr] for _, r in out])):
        with (HERE / name).open('w', encoding='utf-8', newline='') as f:
            csv.writer(f).writerows(table_)

    print(f'展開: {len(out)}/{len(rows)} 行 / {len(groups)} 社')
    if problems:
        print(f'検算エラー {len(problems)} 件:')
        for p in problems[:10]:
            print('  ', p)
    else:
        print('検算: 対象 5 列以外の変化なし / 案件No 保持 / 未置換なし')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
