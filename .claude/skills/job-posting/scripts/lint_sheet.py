#!/usr/bin/env python3
"""Indeed 一括アップロード用シートの検査。

納品するのはこのシートの行なので、原稿 md ではなくこちらが本番の検品になる。
1 件ずつ人が読み返せない件数を扱う前提で、見落とすと法令違反・取り込みエラーに
なる項目だけを機械で潰す。

    python3 lint_sheet.py jobs.xlsx --min-wage 1226
    python3 lint_sheet.py jobs.csv --json

終了コード: 0 = エラーなし / 1 = エラーあり / 2 = 実行エラー
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import asdict
from pathlib import Path

from rules import (
    ERROR,
    WARN,
    Finding,
    OVERTIME_HOURS_RE,
    check_age_expressions,
    check_discrimination,
    check_placeholders,
    check_wage_in_copy,
    render,
    visual_width,
)

# 空欄では掲載できない列。試用期間・固定残業代の従属列は個別に見る。
REQUIRED_COLUMNS: tuple[str, ...] = (
    "ステータス", "会社名", "職種名", "職業カテゴリー", "求人キャッチコピー",
    "勤務地（都道府県・市区町村・町域）", "雇用形態", "有料職業紹介に該当",
    "給与形態", "給与（最低額）", "給与（表示形式）", "固定残業代の有無",
    "勤務形態", "平均所定労働時間", "社会保険", "試用期間の有無",
    "募集要項（仕事内容）", "募集要項（アピールポイント）", "募集要項（求める人材）",
    "募集要項（勤務時間・曜日）", "募集要項（休暇・休日）", "募集要項（給与の補足）",
    "募集要項（待遇・福利厚生）", "募集要項（その他）",
    "採用予定人数", "履歴書の有無", "応募用メールアドレス",
)

# 実ファイルの入力規則から取った選択肢。ここにない値は取り込みで弾かれる。
ENUMS: dict[str, tuple[str, ...]] = {
    "ステータス": ("募集中", "休止中"),
    "雇用形態": ("正社員", "アルバイト・パート", "派遣社員", "契約社員", "業務委託", "インターン", "ボランティア", "新卒"),
    "有料職業紹介に該当": ("はい", "いいえ"),
    "給与形態": ("時給", "日給", "週給", "月給", "年俸", "完全歩合"),
    "給与（表示形式）": ("範囲で表示", "最低額を表示"),
    "固定残業代の有無": ("あり", "なし"),
    "固定残業代（支払い単位）": ("日当たり", "週当たり", "月当たり"),
    "試用期間の有無": ("あり", "なし"),
    "試用期間中の給与形態": ("時給", "日給", "週給", "月給", "年俸"),
    "履歴書の有無": ("必須", "任意"),
    "採用予定人数": tuple(str(n) for n in range(1, 11)) + ("11人以上", "常時募集"),
    "自動アプローチ利用設定": ("利用する", "利用しない"),
}

MULTI_ENUMS: dict[str, tuple[str, ...]] = {
    "タグ": ("社員登用あり", "昇給・昇格あり", "残業なし", "週1日からOK", "週2・3日からOK",
             "シフト自由", "交通費支給", "即日勤務OK", "駅近5分以内", "フルリモート", "在宅OK"),
    "応募者に関する情報": ("電話番号", "性別", "生年月日", "職歴", "資格・免許", "スキル", "学歴", "住所"),
}

FIXED_OT_COLUMNS = ("固定残業代（最低額）", "固定残業代（時間）", "固定残業代（超過分の追加支払への同意）")
PROBATION_COLUMNS = ("試用期間（期間）", "試用期間（期間の単位）")

# 本文が入る列。NG 表現はこれらを連結して当てる。
TEXT_COLUMNS: tuple[str, ...] = (
    "職種名", "求人キャッチコピー", "募集要項（仕事内容）", "募集要項（アピールポイント）",
    "募集要項（求める人材）", "募集要項（勤務時間・曜日）", "募集要項（休暇・休日）",
    "募集要項（勤務地の補足）", "募集要項（アクセス）", "募集要項（給与の補足）",
    "募集要項（待遇・福利厚生）", "募集要項（その他）",
)

JOB_TITLE_MAX_WIDTH = 30
MONTHLY_HOURS_FALLBACK = 160


def load_xlsx(path: Path) -> list[list[list[str]]]:
    """シートごとに表を返す。シートが分かれていれば各々にヘッダー行がある。"""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = [
                "".join(t.text or "" for t in si.iter(ns + "t"))
                for si in ET.fromstring(archive.read("xl/sharedStrings.xml"))
            ]
        sheets = sorted(n for n in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
        if not sheets:
            raise ValueError("ワークシートが見つからない")
        tables: list[list[list[str]]] = []
        for sheet in sheets:
            table: list[dict[str, str]] = []
            for row in ET.fromstring(archive.read(sheet)).iter(ns + "row"):
                cells: dict[str, str] = {}
                for cell in row.iter(ns + "c"):
                    ref = cell.get("r") or ""
                    column = re.match(r"[A-Z]+", ref)
                    if column is None:
                        continue
                    value = cell.find(ns + "v")
                    if value is None:
                        inline = cell.find(ns + "is")
                        text = "".join(t.text or "" for t in inline.iter(ns + "t")) if inline is not None else ""
                    elif cell.get("t") == "s":
                        text = shared[int(value.text or 0)]
                    else:
                        text = value.text or ""
                    cells[column.group(0)] = text
                table.append(cells)
            if not table:
                continue
            names = [column_name(i) for i in range(max_column_index(table) + 1)]
            tables.append([[c.get(n, "") for n in names] for c in table])
    return tables


def column_name(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def max_column_index(table: list[dict[str, str]]) -> int:
    highest = 0
    for cells in table:
        for key in cells:
            value = 0
            for char in key:
                value = value * 26 + ord(char) - 64
            highest = max(highest, value - 1)
    return highest


def load_delimited(path: Path) -> list[list[list[str]]]:
    delimiter = "\t" if path.suffix.lower() in (".tsv", ".tab") else ","
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return [[row for row in csv.reader(handle, delimiter=delimiter)]]


def load(path: Path) -> list[dict[str, str]]:
    """全シートのデータ行を 1 本に束ねる。ヘッダーはシートごとに見つける。"""
    tables = load_xlsx(path) if path.suffix.lower() in (".xlsx", ".xlsm") else load_delimited(path)
    rows: list[dict[str, str]] = []
    for table in tables:
        header_index = next(
            (i for i, row in enumerate(table) if "職種名" in row and "会社名" in row),
            None,
        )
        if header_index is None:
            continue
        header = [cell.strip() for cell in table[header_index]]
        for row in table[header_index + 1:]:
            if not any(cell.strip() for cell in row):
                continue
            padded = list(row) + [""] * (len(header) - len(row))
            rows.append({h: padded[i].strip() for i, h in enumerate(header) if h})
    if not rows:
        raise ValueError("ヘッダー行（会社名・職種名を含む行）が見つからない")
    return rows


def label(row: dict[str, str], index: int) -> str:
    title = row.get("職種名", "")
    return f"行{index}: {title}" if title else f"行{index}"


def check_required(row: dict[str, str], target: str) -> list[Finding]:
    return [
        Finding(target, ERROR, "required", f"必須列が空: {column}")
        for column in REQUIRED_COLUMNS
        if column in row and not row.get(column, "").strip()
    ]


def check_enums(row: dict[str, str], target: str) -> list[Finding]:
    findings = []
    for column, allowed in ENUMS.items():
        value = row.get(column, "").strip()
        if value and value not in allowed:
            findings.append(Finding(
                target, ERROR, "enum",
                f"{column} の値「{value}」は選択肢にない",
                "許可値: " + " / ".join(allowed),
            ))
    for column, allowed in MULTI_ENUMS.items():
        value = row.get(column, "").strip()
        if not value:
            continue
        for item in re.split(r"[、,]", value):
            item = item.strip()
            if item and item not in allowed:
                findings.append(Finding(
                    target, ERROR, "enum",
                    f"{column} の値「{item}」は選択肢にない",
                    "許可値: " + " / ".join(allowed),
                ))
    return findings


def check_wage(row: dict[str, str], target: str, min_wage: int | None) -> list[Finding]:
    findings = []
    low = row.get("給与（最低額）", "").strip()
    if low and not low.isdigit():
        findings.append(Finding(target, ERROR, "wage-format", f"給与（最低額）が半角数字でない: {low}", "カンマ・円・「万」を外す"))
    high = row.get("給与（最高額）", "").strip()
    if high and not high.isdigit():
        findings.append(Finding(target, ERROR, "wage-format", f"給与（最高額）が半角数字でない: {high}"))
    if row.get("給与（表示形式）") == "範囲で表示" and not high:
        findings.append(Finding(target, ERROR, "wage-range", "「範囲で表示」なのに給与（最高額）が空"))
    if low.isdigit() and high.isdigit() and int(high) < int(low):
        findings.append(Finding(target, ERROR, "wage-range", f"給与の上限 {int(high):,} が下限 {int(low):,} より小さい"))

    if min_wage is not None and low.isdigit():
        form = row.get("給与形態", "")
        hours = row.get("平均所定労働時間", "").strip()
        monthly_hours = int(hours) if hours.isdigit() and int(hours) else MONTHLY_HOURS_FALLBACK
        hourly = None
        if form == "時給":
            hourly = int(low)
        elif form == "月給":
            hourly = int(low) / monthly_hours
        elif form == "日給":
            hourly = int(low) / 8
        if hourly is not None and hourly < min_wage:
            findings.append(Finding(
                target, ERROR, "min-wage",
                f"時給換算 {hourly:,.0f}円 が最低賃金 {min_wage:,}円 を下回る（{form} {int(low):,}円 ÷ {monthly_hours}時間）",
            ))
    return findings


def check_conditional_columns(row: dict[str, str], target: str) -> list[Finding]:
    findings = []
    if row.get("固定残業代の有無") == "あり":
        missing = [c for c in FIXED_OT_COLUMNS if not row.get(c, "").strip()]
        if missing:
            findings.append(Finding(
                target, ERROR, "fixed-overtime",
                "固定残業代ありなのに空欄: " + "、".join(missing),
                "額・相当時間数・超過分別途支給の 3 点が揃って初めて適法（職業安定法 5 条の 3）",
            ))
    if row.get("試用期間の有無") == "あり":
        missing = [c for c in PROBATION_COLUMNS if not row.get(c, "").strip()]
        if missing:
            findings.append(Finding(target, ERROR, "probation", "試用期間ありなのに空欄: " + "、".join(missing)))
        if not row.get("試用期間（試用期間中の労働条件）", "").strip():
            findings.append(Finding(
                target, WARN, "probation-terms",
                "試用期間中の労働条件が未記載",
                "本採用と差があるなら明示する。書かないと本採用条件が適用されると解される",
            ))
    if row.get("社会保険（適用されない理由）", "").strip() == "" and not row.get("社会保険", "").strip():
        findings.append(Finding(target, ERROR, "insurance", "社会保険が空で、適用されない理由も未記載"))
    return findings


def check_scope_of_change(row: dict[str, str], target: str, blob: str) -> list[Finding]:
    """2024/4/1 施行の明示ルール。専用列がないので本文に入れるしかない。"""
    findings = []
    if "就業場所の変更の範囲" not in blob:
        findings.append(Finding(
            target, ERROR, "scope-location",
            "就業場所の変更の範囲が未記載（2024/4/1 施行の明示ルール）",
            "募集要項（その他）の末尾に書く。転勤がなくても「変更なし」と明記する",
        ))
    if not re.search(r"(?:従事すべき)?業務の変更の範囲", blob):
        findings.append(Finding(
            target, ERROR, "scope-duties",
            "従事すべき業務の変更の範囲が未記載（2024/4/1 施行の明示ルール）",
            "募集要項（その他）の末尾に書く。変更がなくても「変更なし」と明記する",
        ))
    return findings


def check_title(row: dict[str, str], target: str) -> list[Finding]:
    title = row.get("職種名", "").strip()
    if not title:
        return []
    findings = []
    width = visual_width(title)
    if width > JOB_TITLE_MAX_WIDTH:
        findings.append(Finding(target, WARN, "title-length", f"職種名が全角 {width:.0f} 文字（目安 {JOB_TITLE_MAX_WIDTH} 文字）"))
    if "|" in title:
        findings.append(Finding(target, WARN, "title-separator", "職種名の区切りが半角 | になっている", "全角 ｜ に統一する"))
    if re.search(r"[0-9][0-9,.]*\s*(?:万)?円", title):
        findings.append(Finding(target, WARN, "title-wage", "職種名に給与額が入っている"))
    if re.search(r"[★☆【】]{2,}|[!！]{2,}", title):
        findings.append(Finding(target, WARN, "title-decoration", "職種名の装飾記号が過剰"))
    return findings


def squash(text: str) -> str:
    return re.sub(r"[\s　]+", "", text)


def check_location_match(row: dict[str, str], target: str) -> list[Finding]:
    """職種名の末尾に置いた地名が、勤務地かアクセスに現れるかを見る。

    エリア展開では駅名の列と住所の列を別々に並べて貼るため、1 行ずれると
    全件が「別の駅の住所」になる。目視では気づけないので機械で当てる。
    """
    title = row.get("職種名", "").strip()
    if not title:
        return []
    tail = re.split(r"[｜|/／]", title)[-1].strip()
    if not tail or visual_width(tail) > 12:
        return []
    # 末尾が地名だと読めるときだけ突き合わせる。「正社員」や職種名で終わる職種名は
    # そもそも地名を持たないので、ここで警告を出しても直しようがない。
    if not re.search(r"(都|道|府|県|市|区|町|村|駅|支店|営業所|サービスオフィス|センター)$", tail):
        return []
    place = re.sub(r"(駅|支店|営業所|サービスオフィス|センター)$", "", tail)
    if len(place) < 2:
        return []
    haystack = "".join((
        row.get("勤務地（都道府県・市区町村・町域）", ""),
        row.get("募集要項（勤務地の補足）", ""),
        row.get("募集要項（アクセス）", ""),
    ))
    # 住所は「埼玉県 さいたま市 岩槻区」のように区切られていることがあるので空白を落として比べる。
    if squash(place) in squash(haystack):
        return []
    return [Finding(
        target, WARN, "location-mismatch",
        f"職種名の地名「{tail}」が勤務地・アクセスのどこにも現れない",
        "駅名の列と住所の列がずれていないか確認する",
    )]


def check_consistency(row: dict[str, str], target: str, blob: str) -> list[Finding]:
    findings = []
    tags = row.get("タグ", "")
    if "残業なし" in tags:
        overtime = OVERTIME_HOURS_RE.search(blob)
        if overtime and not re.search(r"残業[^\n。]{0,8}?(?:な|無)し", overtime.group(0)):
            findings.append(Finding(
                target, ERROR, "tag-mismatch",
                f"タグ「残業なし」と本文の記載が矛盾: 「{overtime.group(0)}」",
                "残業があるならタグから「残業なし」を外す",
            ))
    if "性別" in row.get("応募者に関する情報", ""):
        findings.append(Finding(
            target, WARN, "applicant-gender",
            "応募時に性別を取得する設定になっている",
            "選考に使わないなら外す。取得自体が均等法上の疑義を生む",
        ))
    if not row.get("募集要項（休暇・休日）", "") or "年間休日" not in row.get("募集要項（休暇・休日）", ""):
        findings.append(Finding(target, WARN, "holidays", "休暇・休日に年間休日数の記載がない"))
    return findings


def check_duplicates(rows: list[dict[str, str]], threshold: int) -> list[Finding]:
    """同一本文の使い回し。媒体の重複判定に触れて両方の掲載順位が下がる。"""
    groups: dict[str, list[int]] = {}
    for index, row in enumerate(rows, start=2):
        body = row.get("募集要項（仕事内容）", "").strip()
        if body:
            groups.setdefault(body, []).append(index)
    findings = []
    for members in groups.values():
        if len(members) >= threshold:
            findings.append(Finding(
                f"全体（行 {members[0]} ほか {len(members)} 件）", WARN, "duplicate",
                f"仕事内容が完全に同一の求人が {len(members)} 件",
                "職種名の言い換えと同じく、本文も 2〜3 パターン用意して回す",
            ))
    return findings


def lint_row(row: dict[str, str], index: int, min_wage: int | None) -> list[Finding]:
    target = label(row, index)
    blob = "\n".join(row.get(c, "") for c in TEXT_COLUMNS)
    return (
        check_required(row, target)
        + check_enums(row, target)
        + check_wage(row, target, min_wage)
        + check_conditional_columns(row, target)
        + check_scope_of_change(row, target, blob)
        + check_title(row, target)
        + check_location_match(row, target)
        + check_consistency(row, target, blob)
        + check_wage_in_copy(row.get("求人キャッチコピー", ""), target)
        + check_age_expressions(blob, target)
        + check_discrimination(blob, target)
        + check_placeholders(blob, target)
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Indeed 一括アップロード用シートの検査")
    parser.add_argument("path", help="xlsx / csv / tsv")
    parser.add_argument("--min-wage", type=int, default=None, help="地域別最低賃金（時給・円）")
    parser.add_argument("--duplicate-threshold", type=int, default=5, help="同一本文が何件以上なら警告するか（既定 5）")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    path = Path(args.path)
    if not path.is_file():
        print(f"ファイルがない: {path}", file=sys.stderr)
        return 2
    try:
        rows = load(path)
    except (ValueError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"読み込めない: {error}", file=sys.stderr)
        return 2
    if not rows:
        print("データ行がない", file=sys.stderr)
        return 2

    findings: list[Finding] = []
    for index, row in enumerate(rows, start=2):
        findings += lint_row(row, index, args.min_wage)
    findings += check_duplicates(rows, args.duplicate_threshold)

    errors = [f for f in findings if f.severity == ERROR]
    if args.json:
        print(json.dumps({
            "rows": len(rows),
            "errors": len(errors),
            "warnings": len(findings) - len(errors),
            "findings": [asdict(f) for f in findings],
        }, ensure_ascii=False, indent=2))
    else:
        print(render(findings, "件", len(rows)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
