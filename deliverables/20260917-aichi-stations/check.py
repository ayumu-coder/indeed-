# -*- coding: utf-8 -*-
"""5 列 CSV に lint_sheet.py 相当の検証を当てる。

このファイルは Indeed の 67 列シートではないので lint_sheet.py をそのままは使えない。
同じ判定ロジック（rules.py）を、この 5 列に対して適用する。
"""
import csv, pathlib, sys, unicodedata
sys.path.insert(0, '/home/user/indeed-/.claude/skills/job-posting/scripts')
from rules import (ERROR, WARN, Finding, check_age_expressions, check_discrimination,
                   check_placeholders, check_wage_in_copy, render, visual_width)

CSV = pathlib.Path('愛知トップ50駅_軽作業求人_20260917.csv')
TITLE_MAX = 30
CATCH_MAX = 30

def check_row(row: dict, index: int) -> list[Finding]:
    target = f'行{index}: {row["タイトル"]}'
    blob = '\n'.join(row.values())
    findings = []
    for col in ('住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント'):
        if not row.get(col, '').strip():
            findings.append(Finding(target, ERROR, 'required', f'必須列が空: {col}'))
    findings += check_wage_in_copy(row['キャッチコピー'], target)
    findings += check_age_expressions(blob, target)
    findings += check_discrimination(blob, target)
    findings += check_placeholders(blob, target)

    title = row['タイトル']
    if visual_width(title) > TITLE_MAX:
        findings.append(Finding(target, WARN, 'title-length', f'タイトルが全角 {visual_width(title):.0f} 文字'))
    if '|' in title:
        findings.append(Finding(target, WARN, 'title-separator', 'タイトルの区切りが半角 |'))
    if visual_width(row['キャッチコピー']) > CATCH_MAX:
        findings.append(Finding(target, WARN, 'catch-length',
                                f'キャッチコピーが全角 {visual_width(row["キャッチコピー"]):.0f} 文字'))
    if not row['住所'].startswith('愛知県'):
        findings.append(Finding(target, ERROR, 'address', f'住所が愛知県で始まらない: {row["住所"]}'))
    if row['住所'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'address-body', '仕事内容に勤務地が入っていない'))
    return findings

def main() -> int:
    with CSV.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    findings = []
    for i, row in enumerate(rows, start=2):
        findings += check_row(row, i)

    bodies = {}
    for i, row in enumerate(rows, start=2):
        bodies.setdefault(row['仕事内容'], []).append(i)
    for members in bodies.values():
        if len(members) >= 5:
            findings.append(Finding(f'全体（行 {members[0]} ほか）', WARN, 'duplicate',
                                    f'仕事内容が完全に同一の求人が {len(members)} 件'))
    stations = [r['タイトル'] for r in rows]
    if len(set(stations)) != len(stations):
        findings.append(Finding('全体', ERROR, 'duplicate-title', 'タイトルが重複している'))

    print(render(findings, '件', len(rows)))
    return 1 if any(f.severity == ERROR for f in findings) else 0

if __name__ == '__main__':
    sys.exit(main())
