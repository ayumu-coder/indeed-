# -*- coding: utf-8 -*-
"""6 列 CSV に lint_sheet.py 相当の検証を当てる。

lint_sheet.py は Indeed の 67 列シート用でこの形には当てられないため、
同じ判定ロジック（rules.py）を 6 列に適用する。
"""
import csv, pathlib, re, sys
sys.path.insert(0, '/home/user/indeed-/.claude/skills/job-posting/scripts')
from rules import (ERROR, WARN, Finding, check_age_expressions, check_discrimination,
                   check_placeholders, check_wage_in_copy, render, visual_width)

CSV = pathlib.Path('名古屋以西100駅_検品梱包求人_20260918.csv')
COLUMNS = ('駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TEXT_COLUMNS = ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TITLE_MAX = CATCH_MAX = 30

# 依頼で禁止された給与の語。金額そのものに加えて「円」の字も使わない。
WAGE_WORDS = re.compile(r'円|月給|時給|日給|年収|年俸|週給|賞与|インセンティブ')

# 対象エリア（名古屋市全 16 区＋尾張西部）。ここに含まれない住所は範囲外。
AREA_OK = ('名古屋市', '一宮市', '稲沢市', '津島市', '愛西市', '弥富市', '清須市',
           '北名古屋市', 'あま市', '岩倉市', '大治町', '蟹江町', '飛島村', '豊山町')
# 名古屋市より東・南。混入していたら範囲外
AREA_NG = ('豊田市', '岡崎市', '刈谷市', '春日井市', '小牧市', '東海市', '知多市',
           '半田市', '安城市', '瀬戸市', '尾張旭市', '日進市', '大府市', '長久手市')


def check_row(row: dict, index: int) -> list[Finding]:
    target = f'行{index}: {row["タイトル"]}'
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
    if not row['住所'].startswith('愛知県'):
        findings.append(Finding(target, ERROR, 'address', f'住所が愛知県で始まらない: {row["住所"]}'))
    if not any(a in row['住所'] for a in AREA_OK):
        findings.append(Finding(target, ERROR, 'area', f'対象エリア外の住所: {row["住所"]}'))
    if any(a in row['住所'] for a in AREA_NG):
        findings.append(Finding(target, ERROR, 'area', f'名古屋市より東・南の住所: {row["住所"]}'))
    if row['駅名'] not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'station-title', f'タイトルに駅名がない: {row["駅名"]}'))
    if row['住所'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'address-body', '仕事内容に勤務地が入っていない'))
    if row['駅名'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'station-body', f'仕事内容に駅名がない: {row["駅名"]}'))
    return findings


def main() -> int:
    with CSV.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    findings = []
    for i, row in enumerate(rows, start=2):
        findings += check_row(row, i)

    if len(rows) != 100:
        findings.append(Finding('全体', ERROR, 'row-count', f'{len(rows)} 行（100 行であるべき）'))
    for col in ('駅名',) + TEXT_COLUMNS:
        values = [r[col] for r in rows]
        if len(set(values)) != len(values):
            dup = [v for v in set(values) if values.count(v) > 1]
            findings.append(Finding('全体', ERROR, 'duplicate',
                                    f'{col} が重複している（{len(dup)} 種）'))
    print(render(findings, '件', len(rows)))
    return 1 if any(f.severity == ERROR for f in findings) else 0


if __name__ == '__main__':
    sys.exit(main())
