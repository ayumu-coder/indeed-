#!/usr/bin/env python3
"""会社ごとの文面 JSON を全行に展開し、対象 4 列だけを書き換えた表を作る。

指示役が持つ工程。文章は作らず、機械的な展開と検算だけを行う。
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import unicodedata
from collections import OrderedDict

SCRATCH = pathlib.Path(__file__).resolve().parent
TARGETS = ('職種名', '求人キャッチコピー', '募集要項（仕事内容）', '募集要項（アピールポイント）')
KEY_RE = re.compile(r'案件No[：:]\s*(\S+)')


def width(s: str) -> float:
    return sum(2 if unicodedata.east_asian_width(c) in 'WFA' else 1 for c in s) / 2


def area(address: str) -> str:
    """都道府県＋市区町村。町域は落とす。"""
    parts = [p for p in re.split(r'[\s　]+', address.strip()) if p]
    return ''.join(parts[:-1]) if len(parts) > 2 else ''.join(parts)


def place(address: str) -> str:
    """職種名の末尾に置く地名。政令市は区まで。"""
    parts = [p for p in re.split(r'[\s　]+', address.strip()) if p]
    if len(parts) > 2:
        return ''.join(parts[1:-1])
    return parts[1] if len(parts) > 1 else parts[0]


def load_rows():
    table = json.loads((SCRATCH / 'all16_rows.json').read_text(encoding='utf-8'))
    hdr = table[0]
    return hdr, [dict(zip(hdr, r)) for r in table[1:]]


def main() -> int:
    hdr, rows = load_rows()
    groups = OrderedDict()
    for i, r in enumerate(rows, start=2):
        groups.setdefault((r['会社名'], r['職業カテゴリー']), []).append((i, r))

    summary = json.loads((SCRATCH / 'groups' / '_summary.json').read_text(encoding='utf-8'))
    by_company = {(s['company'], s['category']): s['no'] for s in summary}

    applied, missing, problems = [], [], []
    for key, members in groups.items():
        gno = by_company[key]
        spec_path = SCRATCH / 'out' / f'{gno:02d}.json'
        if not spec_path.is_file():
            missing.append((gno, key[0], len(members)))
            for i, r in members:
                applied.append((i, dict(r), None))
            continue
        spec = json.loads(spec_path.read_text(encoding='utf-8'))
        pats = spec['job_body_patterns']
        if not pats:
            problems.append(f'{key[0]}: 本文パターンが 0 本')
            continue
        for n, (i, r) in enumerate(members):
            addr = r['勤務地（都道府県・市区町村・町域）']
            m = KEY_RE.search(r['募集要項（仕事内容）'])
            if m is None:
                problems.append(f'行{i} {key[0]}: 案件No が元の本文にない')
                applied.append((i, dict(r), None))
                continue
            body = pats[n % len(pats)]
            body = body.replace('{{AREA}}', area(addr)).replace('{{NO}}', m.group(1))
            if '{{' in body:
                problems.append(f'行{i} {key[0]}: 未置換のプレースホルダが残った')
            title = spec['job_title_template'].replace('{place}', place(addr))
            r2 = dict(r)
            r2['職種名'] = title
            r2['求人キャッチコピー'] = spec['catch_copy']
            r2['募集要項（仕事内容）'] = body
            r2['募集要項（アピールポイント）'] = spec['appeal']
            for col in hdr:
                if col not in TARGETS and r2[col] != r[col]:
                    problems.append(f'行{i} {key[0]}: 対象外の列 {col} が変化した')
            if KEY_RE.search(body).group(1) != m.group(1):
                problems.append(f'行{i} {key[0]}: 案件No が保持されていない')
            applied.append((i, r2, gno))

    applied.sort(key=lambda x: x[0])
    out_table = [hdr] + [[r.get(h, '') for h in hdr] for _, r, _ in applied]
    (SCRATCH / 'applied_rows.json').write_text(json.dumps(out_table, ensure_ascii=False), encoding='utf-8')

    done = [g for _, _, g in applied if g is not None]
    print(f'展開: {len(done)}/{len(applied)} 行')
    if missing:
        print('未処理の会社:')
        for gno, comp, n in missing:
            print(f'  {gno:02d} {comp} … {n} 行')
    if problems:
        print(f'検算エラー {len(problems)} 件:')
        for p in problems[:20]:
            print('  ', p)
    else:
        print('検算: 対象 4 列以外の変化なし / 案件No 保持 / 未置換なし')

    titles = {r['職種名'] for _, r, g in applied if g is not None}
    over = [t for t in titles if width(t) > 30]
    if over:
        print(f'職種名が全角 30 超: {len(over)} 種')
        for t in over[:5]:
            print(f'   [{width(t):.0f}] {t}')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
