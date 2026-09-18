# -*- coding: utf-8 -*-
"""5 列 CSV に lint_sheet.py 相当の検証を当てる。

このファイルは Indeed の 67 列シートではないので lint_sheet.py をそのままは使えない。
同じ判定ロジック（rules.py）を、この 5 列に対して適用する。
"""
import csv, pathlib, sys, unicodedata
sys.path.insert(0, '/home/user/indeed-/.claude/skills/job-posting/scripts')
from rules import (ERROR, WARN, Finding, check_age_expressions, check_discrimination,
                   check_placeholders, check_wage_in_copy, render, visual_width)

CSV = pathlib.Path('18都道府県トップ10駅_ゲームテスター求人_20260918.csv')
TITLE_MAX = 30
CATCH_MAX = 30

def check_row(row: dict, index: int) -> list[Finding]:
    target = f'行{index}: {row["タイトル"]}'
    blob = '\n'.join(row.values())
    findings = []
    for col in ('都道府県', '駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント'):
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
    if not row['住所'].startswith(row['都道府県']):
        findings.append(Finding(target, ERROR, 'address', f'住所が{row["都道府県"]}で始まらない: {row["住所"]}'))
    if row['駅名'] not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'station-title', f'タイトルに駅名が入っていない: {row["駅名"]}'))
    if row['駅名'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'station-body', f'仕事内容に駅名が入っていない: {row["駅名"]}'))
    if row['住所'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'address-body', '仕事内容に勤務地が入っていない'))
    return findings


NG_BRAND = ('任天堂', 'ソニー', 'カプコン', 'スクウェア', 'バンダイ', 'コナミ', 'セガ',
            'Switch', 'PlayStation', 'PS5', 'Xbox', 'Steam')


def check_brand(row: dict, index: int) -> list[Finding]:
    """特定のタイトル名・開発会社名を書いていないか。"""
    target = f'行{index}: {row["タイトル"]}'
    blob = '\n'.join(row.values())
    return [Finding(target, ERROR, 'brand', f'特定の社名・機種名が入っている: 「{w}」')
            for w in NG_BRAND if w in blob]


def main() -> int:
    with CSV.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    findings = []
    for i, row in enumerate(rows, start=2):
        findings += check_row(row, i)
        findings += check_brand(row, i)

    bodies = {}
    for i, row in enumerate(rows, start=2):
        bodies.setdefault(row['仕事内容'], []).append(i)
    for members in bodies.values():
        if len(members) >= 5:
            findings.append(Finding(f'全体（行 {members[0]} ほか）', WARN, 'duplicate',
                                    f'仕事内容が完全に同一の求人が {len(members)} 件'))
    from collections import Counter
    per_pref = Counter(r['都道府県'] for r in rows)
    for pref, n in per_pref.items():
        if n != 10:
            findings.append(Finding('全体', ERROR, 'pref-count', f'{pref} が {n} 行（10 行であるべき）'))
    keys = [(r['都道府県'], r['駅名']) for r in rows]
    if len(set(keys)) != len(keys):
        findings.append(Finding('全体', ERROR, 'duplicate-station', '同じ都道府県内で駅名が重複している'))
    stations = [r['タイトル'] for r in rows]
    if len(set(stations)) != len(stations):
        findings.append(Finding('全体', ERROR, 'duplicate-title', 'タイトルが重複している'))

    print(render(findings, '件', len(rows)))
    return 1 if any(f.severity == ERROR for f in findings) else 0

if __name__ == '__main__':
    sys.exit(main())
