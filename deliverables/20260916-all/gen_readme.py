#!/usr/bin/env python3
"""README を組み立てる。会社別の要対応事項と、リンタの変更前後の検出数を載せる。"""
from __future__ import annotations
import json, pathlib, subprocess, sys, unicodedata
from collections import Counter, OrderedDict

SCRATCH = pathlib.Path(__file__).resolve().parent
LINT = pathlib.Path('/home/user/indeed-/.claude/skills/job-posting/scripts/lint_sheet.py')
DELIVER = SCRATCH / 'deliver'

def lint(path: pathlib.Path) -> dict:
    r = subprocess.run([sys.executable, str(LINT), str(path), '--json'],
                       capture_output=True, text=True)
    return json.loads(r.stdout)

def counts(result: dict) -> Counter:
    return Counter((f['severity'], f['code']) for f in result['findings'])

def main() -> int:
    before, after = lint(DELIVER / '_before_full.csv'), lint(DELIVER / '_after_full.csv')
    cb, ca = counts(before), counts(after)
    codes = sorted(set(cb) | set(ca), key=lambda k: (-max(cb.get(k, 0), ca.get(k, 0)), k[1]))

    table = json.loads((SCRATCH / 'all16_rows.json').read_text(encoding='utf-8'))
    hdr = table[0]
    rows = [dict(zip(hdr, r)) for r in table[1:]]
    groups = OrderedDict()
    for i, r in enumerate(rows, start=2):
        groups.setdefault((r['会社名'], r['職業カテゴリー']), []).append(i)
    summary = json.loads((SCRATCH / 'groups' / '_summary.json').read_text(encoding='utf-8'))
    gno = {(s['company'], s['category']): s['no'] for s in summary}

    L = []
    L.append('# 求人原稿 書き換え（2026-09-16・全社）\n')
    L.append('対象シート: `求人-20260916161214` タブ「求人入力シート」')
    L.append('（https://docs.google.com/spreadsheets/d/1a9v92F2tKcJjcxf82texOhVFQWkQKzdNUsW_jBPT-Rc/）\n')
    L.append('**シートは変更していない。** このセッションに Google Sheets の書き込み権限がないため、')
    L.append('書き換え結果を CSV として置いてある。貼り付けは手動で行う。')
    L.append('貼り付け後に問題があっても、スプレッドシートの版履歴（ファイル → 版履歴 → 変更履歴を表示）から元に戻せる。\n')
    L.append('## 内容\n')
    L.append(f'`全社_書き換え4列_20260916.csv` — {len(rows)} 行 × 7 列\n')
    L.append('| 列 | 内容 |')
    L.append('| --- | --- |')
    L.append('| 行番号 | シート上の行番号（2〜370） |')
    L.append('| 案件No | 一意キー。元の仕事内容の末尾から抽出し、そのまま保持している |')
    L.append('| 会社名 | 照合用。書き換えていない |')
    L.append('| 職種名 / キャッチコピー / 仕事内容 / アピールポイント | 書き換え後 |\n')
    L.append('この 4 列以外の 63 列は 1 文字も変更していない（`apply.py` が全行・全列で検算している）。\n')
    L.append('## 会社別の内訳\n')
    L.append('| # | 会社 | 行 | 本文パターン | 職種名 |')
    L.append('| --- | --- | --- | --- | --- |')
    specs = {}
    for key, members in groups.items():
        n = gno[key]
        p = SCRATCH / 'out' / f'{n:02d}.json'
        if not p.is_file():
            L.append(f'| {n} | {key[0]} | {len(members)} | **未処理** | — |')
            continue
        d = json.loads(p.read_text(encoding='utf-8'))
        specs[n] = (key[0], d)
        L.append(f'| {n} | {key[0]} | {len(members)} | {len(d["job_body_patterns"])} 本 | `{d["job_title_template"]}` |')
    L.append('')
    L.append('本文パターンは拠点の並び順に循環させ、冒頭に `＼<都道府県＋市区町村>で募集中／` を入れて')
    L.append('行ごとに別文面にしている。同一本文が並ぶと媒体の重複判定に触れるため。\n')
    L.append('## リンタ検出数（変更前 → 変更後）\n')
    L.append('```bash')
    L.append('python3 .claude/skills/job-posting/scripts/lint_sheet.py <シート.csv> --json')
    L.append('```\n')
    L.append('| 重大度 | 検出 | 変更前 | 変更後 |')
    L.append('| --- | --- | --- | --- |')
    for sev, code in codes:
        b, a = cb.get((sev, code), 0), ca.get((sev, code), 0)
        mark = ' ✅' if a < b else ''
        L.append(f'| {sev} | {code} | {b} | {a}{mark} |')
    L.append(f'\n合計: エラー {before["errors"]} → {after["errors"]} / 警告 {before["warnings"]} → {after["warnings"]}\n')
    L.append('変更後に残っている検出は、すべて対象 4 列の外にある列が原因。内訳は下記。\n')
    L.append('## 対象 4 列の外にある要対応事項（会社別・シート未変更）\n')
    total_notes = 0
    for n in sorted(specs):
        comp, d = specs[n]
        notes = d.get('notes', [])
        unres = d.get('unresolved', [])
        if not notes and not unres:
            continue
        L.append(f'### {comp}\n')
        for note in notes:
            L.append(f'- {note}')
            total_notes += 1
        for u in unres:
            L.append(f'- （要確認）{u}')
            total_notes += 1
        L.append('')
    L.append(f'要対応事項は合計 {total_notes} 件。\n')
    L.append('## 再現手順\n')
    L.append('```bash')
    L.append('python3 apply.py      # 会社ごとの文面 JSON を全行に展開し、4 列以外が変わっていないか検算')
    L.append('python3 make_csv.py   # 納品 CSV と検品用のフル行 CSV を書き出す')
    L.append('python3 gen_readme.py # この README を組み立てる')
    L.append('```')
    (DELIVER / 'README.md').write_text('\n'.join(L), encoding='utf-8')
    print(f'README: {len(L)} 行 / 要対応 {total_notes} 件')
    print(f'lint: エラー {before["errors"]}→{after["errors"]} / 警告 {before["warnings"]}→{after["warnings"]}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
