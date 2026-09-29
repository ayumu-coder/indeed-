# -*- coding: utf-8 -*-
"""8 列 CSV に lint_sheet.py / lint_posting.py と同じ判定（rules.py）を当てる。

加えて、9/18・9/28 納品の本文と行単位で突き合わせ、文面を流用していないことを確かめる
（reuse）。飾り罫線や「■」「✔」だけの行は比較対象から外す。
"""
import csv, pathlib, re, sys
HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / '.claude/skills/job-posting/scripts'))
from rules import (ERROR, WARN, Finding, check_age_expressions, check_bullet_spacing,
                   check_discrimination, check_placeholders, check_title_words,
                   check_wage_in_copy, render, visual_width)

FILES = {
    '岐阜': (HERE / '岐阜50駅_検品梱包求人_20260929.csv', '岐阜県', 50),
    '広島': (HERE / '広島50駅_検品梱包求人_20260929.csv', '広島県', 50),
    '三重滋賀': (HERE / '三重滋賀8市50駅_検品梱包求人_20260929.csv', None, 50),
    '結合': (HERE / '岐阜広島三重滋賀150駅_検品梱包求人_20260929.csv', None, 150),
}
PREVIOUS = [
    ROOT / 'deliverables/20260918-aichi-west-100/名古屋以西100駅_検品梱包求人_20260918.csv',
    ROOT / 'deliverables/20260928-aichi-tochigi-inspection-packing/愛知栃木100駅_検品梱包求人_20260928.csv',
]
MIE_SHIGA_CITIES = ('三重県桑名市', '三重県四日市市', '三重県津市', '三重県鈴鹿市', '三重県亀山市',
                    '滋賀県米原市', '滋賀県長浜市', '滋賀県彦根市')
COLUMNS = ('都道府県/区市', '職種', '駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TEXT_COLUMNS = ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TITLE_MAX = CATCH_MAX = 30
WAGE_WORDS = re.compile(r'円|月給|時給|日給|年収|年俸|週給|賞与|インセンティブ|歩合')
FORBIDDEN = re.compile(r'【要確認】|要確認|OK|歓迎')  # 歓迎・OK はタイトルのみ禁止。本文は別途判定


def meaningful_lines(text: str):
    for line in text.split('\n'):
        s = line.strip()
        if len(s) < 6 or re.fullmatch(r'[━─＝┏┓┗┛✦・■✔◆◇《》【】\s]+', s):
            continue
        yield s


def check_row(row: dict, index: int, pref: str | None) -> list[Finding]:
    target = f'行{index}: {row["タイトル"]}'
    blob = '\n'.join(row[c] for c in TEXT_COLUMNS)
    findings = []
    for col in COLUMNS:
        if not row.get(col, '').strip():
            findings.append(Finding(target, ERROR, 'required', f'必須列が空: {col}'))
    if row['職種'] != '検品・梱包作業':
        findings.append(Finding(target, ERROR, 'job', f'職種が違う: {row["職種"]}'))
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
            findings.append(Finding(target, ERROR, 'wage-word', f'{col} に給与の語: 「{hit.group(0)}」'))
        if '要確認' in row[col]:
            findings.append(Finding(target, ERROR, 'placeholder', f'{col} に要確認'))
    if re.search(r'OK|歓迎', row['タイトル']):
        findings.append(Finding(target, ERROR, 'title-word', 'タイトルに OK・歓迎'))
    if visual_width(row['タイトル']) > TITLE_MAX:
        findings.append(Finding(target, WARN, 'title-length', 'タイトルが全角 30 超'))
    if visual_width(row['キャッチコピー']) > CATCH_MAX:
        findings.append(Finding(target, WARN, 'catch-length', 'キャッチコピーが全角 30 超'))
    if '|' in row['タイトル']:
        findings.append(Finding(target, WARN, 'title-separator', 'タイトルの区切りが半角 |'))
    if not re.fullmatch(r'[^｜]+｜[^｜]+｜.+駅(エリア)?', row['タイトル']):
        findings.append(Finding(target, ERROR, 'title-format', 'タイトルが <接頭辞>｜<職種表現>｜<駅名>駅エリア の形でない'))
    if pref and not row['住所'].startswith(pref):
        findings.append(Finding(target, ERROR, 'address', f'住所が{pref}で始まらない: {row["住所"]}'))
    if pref is None and not row['住所'].startswith(('岐阜県', '広島県') + MIE_SHIGA_CITIES):
        findings.append(Finding(target, ERROR, 'address', f'住所が対象の県・市で始まらない: {row["住所"]}'))
    if row['都道府県/区市'] not in row['住所']:
        findings.append(Finding(target, ERROR, 'city', f'都道府県/区市 が住所と合わない: {row["都道府県/区市"]}'))
    if row['駅名'] not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'station-title', f'タイトルに駅名がない: {row["駅名"]}'))
    if row['住所'] not in row['仕事内容'] or f'{row["駅名"]}駅' not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'station-body', '仕事内容に勤務地または駅名がない'))
    return findings


def previous_lines() -> set[str]:
    lines = set()
    for p in PREVIOUS:
        with p.open(encoding='utf-8-sig', newline='') as f:
            for r in csv.DictReader(f):
                for col in TEXT_COLUMNS:
                    lines.update(meaningful_lines(r[col]))
                    lines.add(r[col])
    return lines


def main() -> int:
    bad = 0
    prev = previous_lines()
    for label, (path, pref, expect) in FILES.items():
        findings = []
        if path.read_bytes()[:3] != b'\xef\xbb\xbf':
            findings.append(Finding('全体', ERROR, 'bom', 'UTF-8 BOM が付いていない'))
        with path.open(encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            if tuple(reader.fieldnames or ()) != COLUMNS:
                findings.append(Finding('全体', ERROR, 'columns', f'列が違う: {reader.fieldnames}'))
        for i, row in enumerate(rows, start=2):
            findings += check_row(row, i, pref)
        if len(rows) != expect:
            findings.append(Finding('全体', ERROR, 'row-count', f'{len(rows)} 行（{expect} 行であるべき）'))
        for col in ('駅名',) + TEXT_COLUMNS:
            values = [r[col] for r in rows]
            if len(set(values)) != len(values):
                dup = sorted({v for v in values if values.count(v) > 1})
                findings.append(Finding('全体', ERROR, 'duplicate', f'{col} が重複している: {dup[:3]}'))
        if label == '三重滋賀':
            cities = {}
            for r in rows:
                city = next((c for c in MIE_SHIGA_CITIES if r['住所'].startswith(c)), None)
                if city is None:
                    findings.append(Finding(f'{r["駅名"]}', ERROR, 'city-scope', f'8 市の外: {r["住所"]}'))
                cities[city] = cities.get(city, 0) + 1
            print('  市ごとの内訳:', ', '.join(f'{k} {v}' for k, v in cities.items()))
        reused = set()
        for r in rows:
            for col in TEXT_COLUMNS:
                if r[col] in prev:
                    reused.add(f'{col} 全文')
                reused.update(l for l in meaningful_lines(r[col]) if l in prev)
        if reused:
            findings.append(Finding('全体', ERROR, 'reuse', f'前回・前々回と同じ文面 {len(reused)} 件: {sorted(reused)[:8]}'))
        errors = sum(f.severity == ERROR for f in findings)
        print(f'--- {label} ({path.name}) ---')
        print(render(findings, '件', len(rows)))
        bad += errors
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
