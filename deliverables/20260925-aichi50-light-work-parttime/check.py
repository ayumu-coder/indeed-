# -*- coding: utf-8 -*-
"""8 列 CSV に lint_sheet.py 相当の検証を当てる。

lint_sheet.py / lint_posting.py と同じ判定ロジック（rules.py）を使う。
ハウスルール 3 件（給与額・タイトルの語・箇条書きの空行）はそのまま共有関数を呼ぶ。
"""
import csv, pathlib, re, sys
sys.path.insert(0, '/home/user/indeed-/.claude/skills/job-posting/scripts')
from rules import (ERROR, WARN, Finding, check_age_expressions, check_bullet_spacing,
                   check_discrimination, check_placeholders, check_title_words,
                   check_wage_in_copy, render, visual_width)

CSV = pathlib.Path('愛知50駅_軽作業スタッフ_アルバイトパート週5フルタイム_20260925.csv')
COLUMNS = ('区/市', '職種', '駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TEXT_COLUMNS = ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TITLE_MAX = CATCH_MAX = 30

WAGE_WORDS = re.compile(r'円|月給|時給|日給|年収|年俸|週給|賞与|インセンティブ|歩合')
# 依頼で禁止された短時間・少日数の表現
SHORT_SHIFT = re.compile(r'週[1-4]日|週[1-4]〜|短時間|1日[1-5]時間|扶養の範囲|Wワーク')


def check_row(row: dict, index: int) -> list[Finding]:
    target = f'行{index}: {row["タイトル"]}'
    blob = '\n'.join(row[c] for c in TEXT_COLUMNS)
    findings = []
    for col in COLUMNS:
        if not row.get(col, '').strip():
            findings.append(Finding(target, ERROR, 'required', f'必須列が空: {col}'))
    # ハウスルール 3 件
    findings += check_wage_in_copy(row['キャッチコピー'], target)
    findings += check_title_words(row['タイトル'], target, 'タイトル')
    findings += check_bullet_spacing(row['仕事内容'], target, '仕事内容')
    findings += check_bullet_spacing(row['アピールポイント'], target, 'アピールポイント')
    # 共通の NG 表現
    findings += check_age_expressions(blob, target)
    findings += check_discrimination(blob, target)
    findings += check_placeholders(blob, target)

    for col in TEXT_COLUMNS:
        hit = WAGE_WORDS.search(row[col])
        if hit:
            findings.append(Finding(target, ERROR, 'wage-word',
                                    f'{col} に給与の語が入っている: 「{hit.group(0)}」'))
        hit = SHORT_SHIFT.search(row[col])
        if hit:
            findings.append(Finding(target, ERROR, 'short-shift',
                                    f'{col} に短時間・少日数の表現: 「{hit.group(0)}」'))
    if visual_width(row['タイトル']) > TITLE_MAX:
        findings.append(Finding(target, WARN, 'title-length',
                                f'タイトルが全角 {visual_width(row["タイトル"]):.0f} 文字'))
    if visual_width(row['キャッチコピー']) > CATCH_MAX:
        findings.append(Finding(target, WARN, 'catch-length',
                                f'キャッチコピーが全角 {visual_width(row["キャッチコピー"]):.0f} 文字'))
    if '|' in row['タイトル']:
        findings.append(Finding(target, WARN, 'title-separator', 'タイトルの区切りが半角 |'))
    if not row['住所'].startswith('愛知県'):
        findings.append(Finding(target, ERROR, 'address', f'住所が愛知県で始まらない: {row["住所"]}'))
    if row['区/市'] not in row['住所']:
        findings.append(Finding(target, ERROR, 'city', f'区/市 が住所と合わない: {row["区/市"]}'))
    if row['駅名'] not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'station-title', f'タイトルに駅名がない: {row["駅名"]}'))
    if row['住所'] not in row['仕事内容'] or row['駅名'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'station-body', '仕事内容に勤務地または駅名がない'))
    # 勤務条件が本文に入っているか（依頼の前提）
    if '週5日' not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'shift-body', '仕事内容に週5日以上の記載がない'))
    if '実働8時間' not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'shift-hours', '仕事内容に実働8時間程度の記載がない'))
    if 'アルバイト・パート' not in row['仕事内容'] + row['アピールポイント']:
        findings.append(Finding(target, ERROR, 'employment', '本文に雇用形態の記載がない'))
    return findings


def main() -> int:
    with CSV.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    findings = []
    for i, row in enumerate(rows, start=2):
        findings += check_row(row, i)
    if len(rows) != 50:
        findings.append(Finding('全体', ERROR, 'row-count', f'{len(rows)} 行（50 行であるべき）'))
    for col in ('駅名',) + TEXT_COLUMNS:
        values = [r[col] for r in rows]
        if len(set(values)) != len(values):
            findings.append(Finding('全体', ERROR, 'duplicate', f'{col} が重複している'))
    print(render(findings, '件', len(rows)))
    return 1 if any(f.severity == ERROR for f in findings) else 0


if __name__ == '__main__':
    sys.exit(main())
