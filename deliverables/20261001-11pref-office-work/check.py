# -*- coding: utf-8 -*-
"""8 列 CSV に lint_sheet.py / lint_posting.py と同じ判定（rules.py）を当てる。

この原稿は「女性応募を増やす」という依頼だが、性別に言及する表現は入れられない
（男女雇用機会均等法 5 条）。gender の判定は rules.check_discrimination が持っている。
ここでは加えて以下を弾く。

  wage-word   : 給与の語（「円」を含む）が 4 列のどこかに出る
  script-leak : 日本語原稿にキリル文字やラテン文字が混ざる（生成時に実際に起きた）
  no-appeal   : 依頼の訴求軸（推し活・ネイルなど）がどこにも出ていない

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
from stations_top5 import STATIONS, ORDER

CSV_PATH = pathlib.Path('11都道府県トップ5駅_事務職求人_20261001.csv')
EXPECT_ROWS = 55
COLUMNS = ('都道府県/区市', '職種', '駅名', '住所', 'キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TEXT_COLUMNS = ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント')
TITLE_MAX = CATCH_MAX = 30
WAGE_WORDS = re.compile(r'円|月給|時給|日給|年収|年俸|週給|賞与|インセンティブ|歩合')
# キリル／ギリシャ文字は常に誤り（生成時に「コツコツ」が「коツコツ」になった）。
# ラテン文字は求人で通用する語だけ許可し、それ以外の連なりは弾く。
SCRIPT_CONFUSABLE = re.compile(r'[Ѐ-ӿͰ-Ͽ]')
LATIN_RUN = re.compile(r'[A-Za-z][A-Za-z0-9]*')
LATIN_ALLOWED = frozenset({'Excel', 'Word', 'PowerPoint', 'PDF', 'PC', 'Windows', 'Mac', 'CAD'})
APPEAL_AXIS = re.compile(r'推し活|ライブ|舞台|遠征|ネイル|ヘアカラー|髪色|定時|希望休|有給|有休|趣味')
# 駅名 → あるべき都道府県
PREF_OF_STATION = {s[0]: pref for pref in ORDER for s in STATIONS[pref]}


def check_row(row: dict, index: int) -> list[Finding]:
    target = f'行{index}: {row["タイトル"]}'
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
        leak = SCRIPT_CONFUSABLE.search(row[col])
        if leak:
            findings.append(Finding(target, ERROR, 'script-leak',
                                    f'{col} にキリル／ギリシャ文字: 「{leak.group(0)}」'))
        for run in LATIN_RUN.finditer(row[col]):
            if run.group(0) not in LATIN_ALLOWED:
                findings.append(Finding(target, ERROR, 'script-leak',
                                        f'{col} に許可されていない英字: 「{run.group(0)}」'))
    if not APPEAL_AXIS.search(blob):
        findings.append(Finding(target, ERROR, 'no-appeal',
                                '推し活・ネイルなど依頼の訴求軸がどこにもない'))
    if visual_width(row['タイトル']) > TITLE_MAX:
        findings.append(Finding(target, WARN, 'title-length', 'タイトルが全角 30 超'))
    if visual_width(row['キャッチコピー']) > CATCH_MAX:
        findings.append(Finding(target, WARN, 'catch-length', 'キャッチコピーが全角 30 超'))
    if '|' in row['タイトル']:
        findings.append(Finding(target, WARN, 'title-separator', 'タイトルの区切りが半角 |'))
    pref = PREF_OF_STATION.get(row['駅名'])
    if pref is None:
        findings.append(Finding(target, ERROR, 'station-unknown', f'駅名が一覧にない: {row["駅名"]}'))
    elif not row['住所'].startswith(pref):
        findings.append(Finding(target, ERROR, 'address',
                                f'{row["駅名"]}駅の住所が{pref}で始まらない: {row["住所"]}'))
    if row['都道府県/区市'] not in row['住所']:
        findings.append(Finding(target, ERROR, 'city',
                                f'都道府県/区市 が住所と合わない: {row["都道府県/区市"]}'))
    # 複合駅名はタイトルでは主駅名のみ（location-mismatch を避けるため）
    head = row['駅名'].split('・')[0]
    if head not in row['タイトル']:
        findings.append(Finding(target, ERROR, 'station-title', f'タイトルに駅名がない: {head}'))
    if row['住所'] not in row['仕事内容'] or row['駅名'] not in row['仕事内容']:
        findings.append(Finding(target, ERROR, 'station-body', '仕事内容に勤務地または駅名がない'))
    return findings


def selftest() -> int:
    """わざと違反させた行で、判定が空振りしていないことを示す。"""
    ng = {
        '都道府県/区市': '石川県金沢市', '職種': '事務職（一般事務）',
        '駅名': '新宿', '住所': '福井県福井市中央1丁目',
        'キャッチコピー': '時給1200円！коツコツ◎',
        'タイトル': '未経験OK｜主婦歓迎｜一般事務',
        '仕事内容': '■ データ入力\n\n■ 書類作成\n35歳以下の方を募集します。\n{{要確認: 給与}}',
        'アピールポイント': '✅ 女性活躍中\n\n✔ ネイル自由',
    }
    findings = check_row(ng, 2)
    codes = sorted({f.code for f in findings})
    print('--- selftest（わざと違反させた 1 行） ---')
    print(render(findings, '件', 1))
    want = {'wage-word', 'script-leak', 'title-word', 'bullet-spacing', 'gender',
            'age-limit', 'unresolved', 'station-title', 'station-body', 'city', 'address'}
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
    for col in ('駅名',) + TEXT_COLUMNS:
        values = [r[col] for r in rows]
        if len(set(values)) != len(values):
            findings.append(Finding('全体', ERROR, 'duplicate', f'{col} が重複している'))
    covered = {(PREF_OF_STATION.get(r['駅名']), r['駅名']) for r in rows}
    expected = {(pref, s[0]) for pref in ORDER for s in STATIONS[pref]}
    if covered != expected:
        findings.append(Finding('全体', ERROR, 'coverage',
                                f'駅の網羅が一致しない（不足 {sorted(expected - covered)}）'))
    print(f'--- {CSV_PATH.name} ---')
    print(render(findings, '件', len(rows)))
    return 1 if any(f.severity == ERROR for f in findings) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
