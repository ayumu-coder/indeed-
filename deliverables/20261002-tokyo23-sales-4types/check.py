# -*- coding: utf-8 -*-
"""8 列 CSV に lint_sheet.py / lint_posting.py と同じ判定（rules.py）を当てる。

営業職なので、この納品物では次を特に弾く。

  wage-word   : 給与の語（円・月給・インセンティブ・歩合など）が 4 列のどこかに出る
  promise     : 根拠のない断定（ノルマなし／稼げる／直行直帰 など事業者ごとに違うこと）
  script-leak : 和文原稿にキリル／ギリシャ文字、許可外の英字が混ざる
  inbound-only: 反響営業でしか書けない「テレアポ・飛び込みなし」を他職種で書いている

`python3 check.py --selftest` で、わざと違反させた行を流して
判定が空振りしていないことを確認できる。
"""
import csv, pathlib, re, sys
_REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / '.claude/skills/job-posting/scripts'))
from rules import (ERROR, WARN, Finding, check_age_expressions, check_bullet_spacing,
                   check_discrimination, check_placeholders, check_title_words,
                   check_wage_in_copy, render, visual_width)
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from jobs import JOBS
from wards import WARDS

CSV_PATH = pathlib.Path('東京23区_モバイル_ルート_反響_新規開拓営業求人_20261002.csv')
EXPECT_ROWS = len(WARDS) * len(JOBS)
COLUMNS = ('区', '職種', '駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TEXT_COLUMNS = ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TITLE_MAX = CATCH_MAX = 30

WAGE_WORDS = re.compile(r'円|月給|時給|日給|年収|年俸|週給|賞与|インセンティブ|歩合|報奨|奨励金')
# 営業求人で過大表示になりやすい断定。事業者の実態が未確認のうちは書かない。
PROMISE_WORDS = re.compile(
    r'ノルマ(?:は)?(?:なし|ありません)|ノルマなし|残業(?:は)?(?:なし|ありません)'
    r'|稼げ|高収入|高待遇|必ず|誰でも|簡単に|土日休み|完全週休|直行直帰|社用車|フレックス'
    r'|転勤(?:は)?(?:なし|ありません)|昇給|昇格|独立|即日')
SCRIPT_CONFUSABLE = re.compile(r'[Ѐ-ӿͰ-Ͽ]')
LATIN_RUN = re.compile(r'[A-Za-z][A-Za-z0-9]*')
LATIN_ALLOWED = frozenset({'Excel', 'Word', 'PowerPoint', 'PDF', 'PC', 'Windows', 'Mac'})
# 「テレアポ・飛び込みなし」は反響営業の定義。他職種では事業者ごとの実態なので書けない。
INBOUND_ONLY = re.compile(r'(?:テレアポ|飛び込み|架電先)[^。\n]{0,12}(?:なし|ありません|しません)')
INBOUND_KEY = '反響営業（問い合わせ対応）'
JOB_NAMES = {spec.name for spec in JOBS}
WARD_STATION = {w[0]: (w[1], w[2]) for w in WARDS}


def check_row(row: dict, index: int) -> list[Finding]:
    target = f'行{index}: {row["区"]}／{row["職種"]}'
    blob = '\n'.join(row[c] for c in TEXT_COLUMNS)
    findings: list[Finding] = []
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
        hit = PROMISE_WORDS.search(row[col])
        if hit:
            findings.append(Finding(target, ERROR, 'promise',
                                    f'{col} に根拠のない断定: 「{hit.group(0)}」',
                                    '事業者の実態を確認できるまで断定しない（職業安定法 5 条の 3・65 条）'))
        leak = SCRIPT_CONFUSABLE.search(row[col])
        if leak:
            findings.append(Finding(target, ERROR, 'script-leak',
                                    f'{col} にキリル／ギリシャ文字: 「{leak.group(0)}」'))
        for run in LATIN_RUN.finditer(row[col]):
            if run.group(0) not in LATIN_ALLOWED:
                findings.append(Finding(target, ERROR, 'script-leak',
                                        f'{col} に許可されていない英字: 「{run.group(0)}」'))

    if row['職種'] != INBOUND_KEY:
        hit = INBOUND_ONLY.search(blob)
        if hit:
            findings.append(Finding(target, ERROR, 'inbound-only',
                                    f'反響営業以外で「{hit.group(0)}」と断定している',
                                    'テレアポ・飛び込みの有無は事業者ごと。反響営業だけが定義上書ける'))

    if visual_width(row['タイトル']) > TITLE_MAX:
        findings.append(Finding(target, WARN, 'title-length', 'タイトルが全角 30 超'))
    if visual_width(row['キャッチコピー']) > CATCH_MAX:
        findings.append(Finding(target, WARN, 'catch-length', 'キャッチコピーが全角 30 超'))
    if '|' in row['タイトル']:
        findings.append(Finding(target, WARN, 'title-separator', 'タイトルの区切りが半角 |'))
    if row['職種'] not in JOB_NAMES:
        findings.append(Finding(target, ERROR, 'job-unknown', f'職種が一覧にない: {row["職種"]}'))
    expected = WARD_STATION.get(row['区'])
    if expected is None:
        findings.append(Finding(target, ERROR, 'ward-unknown', f'区が一覧にない: {row["区"]}'))
    else:
        station, address = expected
        if row['駅名'] != station:
            findings.append(Finding(target, ERROR, 'station', f'{row["区"]}の駅名が一致しない: {row["駅名"]}'))
        if row['住所'] != address:
            findings.append(Finding(target, ERROR, 'address', f'{row["区"]}の住所が一致しない: {row["住所"]}'))
    if row['区'] not in row['住所']:
        findings.append(Finding(target, ERROR, 'ward', f'区が住所と合わない: {row["区"]}'))
    if row['区'] not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'ward-title', f'タイトルに区名がない: {row["区"]}'))
    if row['住所'] not in row['仕事内容'] or row['駅名'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'ward-body', '仕事内容に勤務地または駅名がない'))
    return findings


def selftest() -> int:
    """わざと違反させた行で、判定が空振りしていないことを示す。"""
    ng = {
        '区': '港区', '職種': '新規開拓営業', '駅名': '新宿', '住所': '東京都新宿区歌舞伎町一丁目',
        'キャッチコピー': '月給40万円も可◎женщина歓迎！',
        'タイトル': '未経験OK｜ノルマなし｜主婦歓迎',
        '仕事内容': '■ 架電\n\n■ 訪問\nテレアポ・飛び込みはありません。\n35歳以下の方を募集します。\n{{要確認: 給与}}',
        'アピールポイント': '✅ 稼げる営業\n\n✔ 直行直帰',
    }
    findings = check_row(ng, 2)
    codes = sorted({f.code for f in findings})
    print('--- selftest（わざと違反させた 1 行） ---')
    print(render(findings, '件', 1))
    want = {'wage-word', 'promise', 'script-leak', 'inbound-only', 'title-word',
            'bullet-spacing', 'gender', 'age-limit', 'unresolved',
            'ward', 'ward-title', 'ward-body', 'station', 'address'}
    missing = want - set(codes)
    print(f'検出コード: {codes}')
    if missing:
        print(f'NG: 検出されるべきだが出なかった: {sorted(missing)}')
        return 1
    print('OK: 判定は空振りしていない')
    return 0


def main(argv: list[str]) -> int:
    if '--selftest' in argv:
        return selftest()
    with CSV_PATH.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    findings: list[Finding] = []
    for i, row in enumerate(rows, start=2):
        findings += check_row(row, i)
    if len(rows) != EXPECT_ROWS:
        findings.append(Finding('全体', ERROR, 'row-count', f'{len(rows)} 行（{EXPECT_ROWS} 行であるべき）'))
    for col in TEXT_COLUMNS:
        values = [r[col] for r in rows]
        if len(set(values)) != len(values):
            findings.append(Finding('全体', ERROR, 'duplicate', f'{col} が重複している'))
    covered = {(r['区'], r['職種']) for r in rows}
    expected = {(w[0], spec.name) for spec in JOBS for w in WARDS}
    if covered != expected:
        findings.append(Finding('全体', ERROR, 'coverage',
                                f'区 × 職種の網羅が一致しない（不足 {sorted(expected - covered)}）'))
    print(f'--- {CSV_PATH.name} ---')
    print(render(findings, '件', len(rows)))
    return 1 if any(f.severity == ERROR for f in findings) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
