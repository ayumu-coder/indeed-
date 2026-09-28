# -*- coding: utf-8 -*-
"""8 列 CSV に lint_sheet.py / lint_posting.py と同じ判定（rules.py）を当てる。"""
import csv, pathlib, re, sys
sys.path.insert(0, '/home/user/indeed-/.claude/skills/job-posting/scripts')
from rules import (ERROR, WARN, Finding, check_age_expressions, check_bullet_spacing,
                   check_discrimination, check_placeholders, check_title_words,
                   check_wage_in_copy, render, visual_width)

FILES = {
    '愛知': (pathlib.Path('愛知50駅_検品梱包求人_20260928.csv'), '愛知県', 50),
    '栃木': (pathlib.Path('栃木50駅_検品梱包求人_20260928.csv'), '栃木県', 50),
    '結合': (pathlib.Path('愛知栃木100駅_検品梱包求人_20260928.csv'), None, 100),
}
COLUMNS = ('都道府県/区市', '職種', '駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TEXT_COLUMNS = ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TITLE_MAX = CATCH_MAX = 30
WAGE_WORDS = re.compile(r'円|月給|時給|日給|年収|年俸|週給|賞与|インセンティブ|歩合')


def check_row(row: dict, index: int, pref: str | None) -> list[Finding]:
    target = f'行{index}: {row["タイトル"]}'
    blob = '\n'.join(row[c] for c in TEXT_COLUMNS)
    findings = []
    for col in COLUMNS:
        if not row.get(col, '').strip():
            findings.append(Finding(target, ERROR, 'required', f'必須列が空: {col}'))
    findings += check_wage_in_copy(row['キャッチコピー'], target)
    findings += check_title_words(row['タイトル'], target, 'タイトル')
    findings += check_bullet_spacing(row['仕事内容'], target, '仕事内容')
    findings += check_bullet_spacing(row['アピールポイント'], target, 'アピールポイント')
    findings += check_age_expressions(blob, target)
    findings += check_discrimination(blob, target)
    findings += check_placeholders(blob, target)
    for col in TEXT_COLUMNS:
        hit = WAGE_WORDS.search(row[col])
        if hit:
            findings.append(Finding(target, ERROR, 'wage-word',
                                    f'{col} に給与の語: 「{hit.group(0)}」'))
    if visual_width(row['タイトル']) > TITLE_MAX:
        findings.append(Finding(target, WARN, 'title-length', 'タイトルが全角 30 超'))
    if visual_width(row['キャッチコピー']) > CATCH_MAX:
        findings.append(Finding(target, WARN, 'catch-length', 'キャッチコピーが全角 30 超'))
    if '|' in row['タイトル']:
        findings.append(Finding(target, WARN, 'title-separator', 'タイトルの区切りが半角 |'))
    if pref and not row['住所'].startswith(pref):
        findings.append(Finding(target, ERROR, 'address', f'住所が{pref}で始まらない: {row["住所"]}'))
    if row['都道府県/区市'] not in row['住所']:
        findings.append(Finding(target, ERROR, 'city', f'都道府県/区市 が住所と合わない: {row["都道府県/区市"]}'))
    if row['駅名'] not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'station-title', f'タイトルに駅名がない: {row["駅名"]}'))
    if row['住所'] not in row['仕事内容'] or row['駅名'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'station-body', '仕事内容に勤務地または駅名がない'))
    return findings


def main() -> int:
    bad = 0
    for label, (path, pref, expect) in FILES.items():
        with path.open(encoding='utf-8-sig', newline='') as f:
            rows = list(csv.DictReader(f))
        findings = []
        for i, row in enumerate(rows, start=2):
            findings += check_row(row, i, pref)
        if len(rows) != expect:
            findings.append(Finding('全体', ERROR, 'row-count', f'{len(rows)} 行（{expect} 行であるべき）'))
        for col in ('駅名',) + TEXT_COLUMNS:
            values = [r[col] for r in rows]
            if len(set(values)) != len(values):
                findings.append(Finding('全体', ERROR, 'duplicate', f'{col} が重複している'))
        errors = sum(f.severity == ERROR for f in findings)
        print(f'--- {label} ({path.name}) ---')
        print(render(findings, '件', len(rows)))
        bad += errors
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
