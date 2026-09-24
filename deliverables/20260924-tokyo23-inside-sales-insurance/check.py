# -*- coding: utf-8 -*-
"""8 列 CSV に lint_sheet.py 相当の検証を当てる。

lint_sheet.py は Indeed の 67 列シート用でこの形には当てられないため、
同じ判定ロジック（rules.py）を 8 列に適用する。
"""
import csv, pathlib, re, sys
sys.path.insert(0, '/home/user/indeed-/.claude/skills/job-posting/scripts')
from rules import (ERROR, WARN, Finding, check_age_expressions, check_discrimination,
                   check_placeholders, check_wage_in_copy, render, visual_width)

CSV = pathlib.Path('東京23区_インサイドセールス_保険営業求人_20260924.csv')
COLUMNS = ('区', '職種', '駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TEXT_COLUMNS = ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TITLE_MAX = CATCH_MAX = 30

# 給与額の禁止。金額そのものに加えて「円」の字も使わない。
WAGE_WORDS = re.compile(r'円|月給|時給|日給|年収|年俸|週給|賞与|インセンティブ|歩合')

WARDS_23 = (
    "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
    "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
    "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
)
JOBS = ("インサイドセールス", "保険営業")


def check_row(row: dict, index: int) -> list[Finding]:
    target = f'行{index}: {row["区"]}／{row["職種"]}'
    blob = '\n'.join(row[c] for c in TEXT_COLUMNS)
    findings = []
    for col in COLUMNS:
        if not row.get(col, '').strip():
            findings.append(Finding(target, ERROR, 'required', f'必須列が空: {col}'))
    findings += check_wage_in_copy(row['キャッチコピー'], target)
    findings += check_age_expressions(blob, target)
    findings += check_discrimination(blob, target)
    findings += check_placeholders(blob, target)

    for col in TEXT_COLUMNS:
        hit = WAGE_WORDS.search(row[col])
        if hit:
            findings.append(Finding(target, ERROR, 'wage-word',
                                    f'{col} に給与に関する語が入っている: 「{hit.group(0)}」'))
    if visual_width(row['タイトル']) > TITLE_MAX:
        findings.append(Finding(target, WARN, 'title-length',
                                f'タイトルが全角 {visual_width(row["タイトル"]):.0f} 文字'))
    if visual_width(row['キャッチコピー']) > CATCH_MAX:
        findings.append(Finding(target, WARN, 'catch-length',
                                f'キャッチコピーが全角 {visual_width(row["キャッチコピー"]):.0f} 文字'))
    if '|' in row['タイトル']:
        findings.append(Finding(target, WARN, 'title-separator', 'タイトルの区切りが半角 |'))
    if row['区'] not in WARDS_23:
        findings.append(Finding(target, ERROR, 'ward', f'東京 23 区にない区名: {row["区"]}'))
    if row['職種'] not in JOBS:
        findings.append(Finding(target, ERROR, 'job', f'対象外の職種: {row["職種"]}'))
    if not row['住所'].startswith('東京都'):
        findings.append(Finding(target, ERROR, 'address', f'住所が東京都で始まらない: {row["住所"]}'))
    if row['区'] not in row['住所']:
        findings.append(Finding(target, ERROR, 'address-ward', f'住所に区名がない: {row["住所"]}'))
    if row['区'] not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'ward-title', f'タイトルに区名がない: {row["区"]}'))
    if row['区'] not in row['仕事内容'] or row['住所'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'ward-body', '仕事内容に区名または勤務地が入っていない'))
    if row['駅名'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'station-body', f'仕事内容に駅名がない: {row["駅名"]}'))
    return findings


def main() -> int:
    with CSV.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    findings = []
    for i, row in enumerate(rows, start=2):
        findings += check_row(row, i)

    if len(rows) != 46:
        findings.append(Finding('全体', ERROR, 'row-count', f'{len(rows)} 行（46 行であるべき）'))
    for job in JOBS:
        wards = {r['区'] for r in rows if r['職種'] == job}
        missing = set(WARDS_23) - wards
        if missing:
            findings.append(Finding('全体', ERROR, 'ward-coverage',
                                    f'{job} に不足している区: {"、".join(sorted(missing))}'))
        if len([r for r in rows if r['職種'] == job]) != 23:
            findings.append(Finding('全体', ERROR, 'job-count', f'{job} が 23 行でない'))
    for col in TEXT_COLUMNS:
        values = [r[col] for r in rows]
        if len(set(values)) != len(values):
            dup = [v for v in set(values) if values.count(v) > 1]
            findings.append(Finding('全体', ERROR, 'duplicate', f'{col} が重複（{len(dup)} 種）'))
    keys = [(r['区'], r['職種']) for r in rows]
    if len(set(keys)) != len(keys):
        findings.append(Finding('全体', ERROR, 'duplicate-key', '区 × 職種 の組み合わせが重複'))

    print(render(findings, '件', len(rows)))
    return 1 if any(f.severity == ERROR for f in findings) else 0


if __name__ == '__main__':
    sys.exit(main())
