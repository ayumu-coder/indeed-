#!/usr/bin/env python3
"""求人原稿の機械チェック。

大量作成では 1 件ずつ人が読み返すのが現実的でないため、見落とすと法令違反になる
項目だけを機械で潰す。文章の質は判断できないので、ここで見るのは「書いてあるか」
「書いてはいけない語がないか」だけ。

    python3 lint_posting.py draft.md [draft2.md ...] --min-wage 1114
    python3 lint_posting.py out/ --min-wage 1114 --json

終了コード: 0 = エラーなし / 1 = エラーあり / 2 = 実行エラー
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, asdict

from rules import check_title_words, check_wage_in_copy
from pathlib import Path

ERROR = "error"
WARN = "warn"

# 職種名の全角換算の上限。媒体の表示幅であって法令ではないので警告どまり。
JOB_TITLE_MAX_WIDTH = 30

REQUIRED_SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("職種名", ("職種名",)),
    ("仕事内容", ("仕事内容", "業務内容")),
    ("給与", ("給与", "賃金")),
    ("勤務地", ("勤務地", "就業場所")),
    ("勤務時間", ("勤務時間", "就業時間")),
    ("休日休暇", ("休日", "休暇")),
    ("応募資格", ("応募資格", "必要な経験", "求める人材")),
    ("待遇・福利厚生", ("待遇", "福利厚生")),
    ("雇用形態", ("雇用形態",)),
    ("選考フロー", ("選考",)),
)

# 年齢制限。例外事由（労働施策総合推進法 9 条）の明記があるかは別途判定する。
AGE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"(?<![0-9])[0-9]{2}\s*歳\s*(?:以上|以下|未満|まで)", "年齢の上限・下限"),
    (r"[0-9]{2}\s*[〜~ー-]\s*[0-9]{2}\s*歳", "年齢レンジ"),
    (r"[0-9]{2}\s*代(?:の方|限定|中心)?(?:歓迎|活躍|募集)", "年代指定"),
    (r"若手(?:の方)?(?:歓迎|募集|限定)", "若年層の限定"),
    (r"(?:シニア|中高年)(?:の方)?(?:歓迎|募集|限定)", "年齢層の限定"),
    (r"新卒(?:のみ|限定)", "新卒限定"),
)
AGE_EXEMPTION_HINTS = ("例外事由", "定年", "労働基準法", "長期勤続によるキャリア形成", "技能・ノウハウの継承")

GENDER_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"営業マン|セールスマン", "営業職 と書く"),
    (r"看護婦|看護夫", "看護師 と書く"),
    (r"保母|保父", "保育士 と書く"),
    (r"ウェイトレス|ウェイター", "ホールスタッフ と書く"),
    (r"スチュワーデス", "客室乗務員 と書く"),
    (r"(?:女性|男性|婦人|主婦|主夫)(?:の方)?(?:限定|のみ|歓迎|活躍中|活躍)", "性別による限定・優遇は書けない"),
    (r"(?:男女)いずれか", "性別による限定は書けない"),
)

BODY_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"身長\s*[0-9]{3}\s*cm", "身長要件（間接差別）"),
    (r"体重\s*[0-9]{2,3}\s*kg", "体重要件（間接差別）"),
    (r"容姿(?:端麗|に自信)", "容姿要件"),
)

NATIONALITY_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"日本国籍(?:の方)?(?:限定|のみ|に限る)", "国籍による限定"),
    (r"外国籍(?:の方)?(?:不可|お断り)", "国籍による排除"),
    (r"既婚者(?:のみ|限定)|未婚者(?:のみ|限定)|子[供ど]も(?:のいない|がいない)", "家族構成による限定"),
)

APPLICANT_COST_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"登録料|入会金|(?:研修|教材|講習)費(?:用)?(?:は)?(?:自己負担|ご負担)", "応募者への金銭負担の要求"),
)

PLACEHOLDER_RE = re.compile(r"\{\{\s*(?!要確認)([^}]+?)\s*\}\}")
UNRESOLVED_RE = re.compile(r"\{\{\s*要確認[:：]?\s*([^}]*?)\s*\}\}")

FIXED_OT_RE = re.compile(r"固定残業|みなし残業|定額残業")
FIXED_OT_AMOUNT_RE = re.compile(r"固定残業(?:代|手当)?[^\n。]{0,20}?([0-9][0-9,]{2,})\s*円")
FIXED_OT_HOURS_RE = re.compile(r"([0-9]{1,3})\s*時間(?:分|相当)")
FIXED_OT_EXCESS_RE = re.compile(r"(?:超|超過|上回|超えた)[^\n。]{0,30}?(?:別途支給|別途お支払|全額支給|支給(?:し|いた)ます)")

HOURLY_WAGE_RE = re.compile(r"時給\s*([0-9][0-9,]*)\s*円")
MONTHLY_WAGE_RE = re.compile(r"月給\s*([0-9][0-9,]*)\s*円")
OPEN_LOWER_BOUND_RE = re.compile(r"(?:^|[^0-9])[〜~]\s*[0-9][0-9,]*\s*円")


@dataclass(frozen=True)
class Finding:
    file: str
    severity: str
    code: str
    message: str
    hint: str = ""


def visual_width(text: str) -> float:
    """全角換算の文字数。媒体の表示幅は文字数ではなく幅で決まる。"""
    return sum(2 if unicodedata.east_asian_width(ch) in "WFA" else 1 for ch in text) / 2


def to_int(raw: str) -> int:
    return int(raw.replace(",", ""))


def strip_code_fences(text: str) -> str:
    """原稿例を囲うコードフェンス自体は判定対象にしない（中身は残す）。"""
    return re.sub(r"^```[^\n]*$", "", text, flags=re.MULTILINE)


def extract_job_title(text: str) -> str | None:
    """「職種名」見出しの直後にある最初の非空行を職種名とみなす。"""
    match = re.search(r"^#{1,6}\s*職種名\s*$", text, flags=re.MULTILINE)
    if match is None:
        match = re.search(r"^\s*(?:\*\*)?職種名(?:\*\*)?\s*[:：]\s*(.+)$", text, flags=re.MULTILINE)
        return match.group(1).strip() if match else None
    for line in text[match.end():].splitlines():
        stripped = line.strip().strip("`")
        if stripped:
            return stripped
    return None


def extract_catch_copy(text: str) -> str | None:
    """「キャッチコピー」見出しの直後、または `キャッチコピー: ...` 行の中身。"""
    match = re.search(r"^#{1,6}\s*(?:求人)?キャッチコピー\s*$", text, flags=re.MULTILINE)
    if match is None:
        inline = re.search(r"^\s*(?:\*\*)?(?:求人)?キャッチコピー(?:\*\*)?\s*[:：|]\s*(.+)$", text, flags=re.MULTILINE)
        return inline.group(1).strip().strip("|").strip() if inline else None
    for line in text[match.end():].splitlines():
        stripped = line.strip().strip("`")
        if stripped:
            return stripped
    return None


def check_sections(text: str, path: str) -> list[Finding]:
    findings = []
    for label, aliases in REQUIRED_SECTIONS:
        if not any(alias in text for alias in aliases):
            findings.append(Finding(path, ERROR, "missing-section", f"必須項目が見当たらない: {label}"))
    return findings


def check_fixed_overtime(text: str, path: str) -> list[Finding]:
    """固定残業代は ①額 ②相当時間数 ③超過分別途支給 が揃って初めて適法。"""
    if not FIXED_OT_RE.search(text):
        return []
    if re.search(r"固定残業(?:代|手当)?[^\n。]{0,10}?(?:なし|無し|無)", text):
        return []

    missing = []
    if not FIXED_OT_AMOUNT_RE.search(text):
        missing.append("①固定残業代の額")
    if not FIXED_OT_HOURS_RE.search(text):
        missing.append("②相当する時間数")
    if not FIXED_OT_EXCESS_RE.search(text):
        missing.append("③超過分を別途支給する旨")
    if not missing:
        return []
    return [Finding(
        path, ERROR, "fixed-overtime",
        "固定残業代の 3 点セットが欠けている: " + "、".join(missing),
        "例）固定残業代 40,000円（時間外労働20時間分）を含む。20時間を超える時間外労働分は別途支給。",
    )]


def check_scope_of_change(text: str, path: str) -> list[Finding]:
    """2024/4/1 施行の明示ルール。変更がない場合も「変更なし」と書く必要がある。"""
    findings = []
    if "就業場所の変更の範囲" not in text:
        findings.append(Finding(
            path, ERROR, "scope-location",
            "就業場所の変更の範囲が未記載（2024/4/1 施行の明示ルール）",
            "転勤がない場合も「変更なし」と明記する",
        ))
    if not re.search(r"(?:従事すべき)?業務の変更の範囲", text):
        findings.append(Finding(
            path, ERROR, "scope-duties",
            "従事すべき業務の変更の範囲が未記載（2024/4/1 施行の明示ルール）",
            "変更がない場合も「変更なし」と明記する",
        ))
    return findings


def check_fixed_term(text: str, path: str) -> list[Finding]:
    if not re.search(r"契約社員|有期|期間の定めあり|契約期間\s*[:：]?\s*[0-9]", text):
        return []
    if re.search(r"期間の定めなし|無期雇用", text):
        return []
    findings = []
    if not re.search(r"更新(?:の)?(?:上限|有無|可能性|あり|なし)", text):
        findings.append(Finding(path, ERROR, "fixed-term-renewal", "有期契約だが更新の有無・上限が未記載"))
    if not re.search(r"無期転換", text):
        findings.append(Finding(
            path, WARN, "fixed-term-conversion",
            "無期転換申込機会と転換後の労働条件の記載がない",
            "通算 5 年を超える更新がありうる場合は必須",
        ))
    return findings


def check_wage(text: str, path: str, min_wage: int | None) -> list[Finding]:
    findings = []
    if min_wage is not None:
        for raw in HOURLY_WAGE_RE.findall(text):
            wage = to_int(raw)
            if wage < min_wage:
                findings.append(Finding(
                    path, ERROR, "min-wage",
                    f"時給 {wage:,}円 が地域別最低賃金 {min_wage:,}円 を下回る",
                ))
    if OPEN_LOWER_BOUND_RE.search(text) and not MONTHLY_WAGE_RE.search(text) and not HOURLY_WAGE_RE.search(text):
        findings.append(Finding(
            path, WARN, "wage-upper-only",
            "上限のみの給与表示に見える",
            "下限額を明示する（`月給250,000円〜350,000円`）",
        ))
    return findings


def check_patterns(text: str, path: str, patterns, code: str, severity: str, label: str) -> list[Finding]:
    findings = []
    for pattern, note in patterns:
        match = re.search(pattern, text)
        if match:
            findings.append(Finding(path, severity, code, f"{label}: 「{match.group(0)}」", note))
    return findings


def check_age(text: str, path: str) -> list[Finding]:
    hits = check_patterns(text, path, AGE_PATTERNS, "age-limit", ERROR, "年齢制限の表現")
    if hits and any(hint in text for hint in AGE_EXEMPTION_HINTS):
        return [Finding(
            f.file, WARN, f.code,
            f.message + "（例外事由らしき記載あり）",
            "労働施策総合推進法 9 条の例外に該当するか、理由が原稿に書かれているか確認する",
        ) for f in hits]
    return hits


def check_misc(text: str, path: str) -> list[Finding]:
    findings = []
    if "受動喫煙" not in text:
        findings.append(Finding(path, ERROR, "smoking", "受動喫煙防止措置が未記載（健康増進法）"))

    for match in UNRESOLVED_RE.finditer(text):
        item = match.group(1) or "項目不明"
        findings.append(Finding(path, WARN, "unresolved", f"未確認のまま: {item}", "入稿前に確定させる"))
    for match in PLACEHOLDER_RE.finditer(text):
        findings.append(Finding(
            path, ERROR, "placeholder",
            f"テンプレートのプレースホルダが残っている: {{{{{match.group(1)}}}}}",
        ))

    title = extract_job_title(text)
    if title is not None:
        width = visual_width(title)
        if width > JOB_TITLE_MAX_WIDTH:
            findings.append(Finding(
                path, WARN, "title-length",
                f"職種名が全角 {width:.0f} 文字（目安 {JOB_TITLE_MAX_WIDTH} 文字）",
                "スマホ検索結果では先頭 15〜20 文字しか表示されない",
            ))
        if re.search(r"[★☆【】]{2,}|[!！]{2,}", title):
            findings.append(Finding(path, WARN, "title-decoration", f"職種名の装飾記号が過剰: {title}"))
        if re.search(r"[0-9][0-9,.]*\s*(?:万)?円", title):
            findings.append(Finding(path, WARN, "title-wage", "職種名に給与額が入っている"))
    return findings


def lint(path: Path, min_wage: int | None) -> list[Finding]:
    raw = path.read_text(encoding="utf-8")
    text = strip_code_fences(raw)
    name = str(path)
    findings: list[Finding] = []
    findings += check_sections(text, name)
    findings += check_fixed_overtime(text, name)
    findings += check_scope_of_change(text, name)
    findings += check_fixed_term(text, name)
    findings += check_wage(text, name, min_wage)
    findings += check_age(text, name)
    findings += check_patterns(text, name, GENDER_PATTERNS, "gender", ERROR, "性別を限定する表現")
    findings += check_patterns(text, name, BODY_PATTERNS, "physical", ERROR, "身体的要件")
    findings += check_patterns(text, name, NATIONALITY_PATTERNS, "attribute", ERROR, "属性による限定")
    findings += check_patterns(text, name, APPLICANT_COST_PATTERNS, "applicant-cost", ERROR, "応募者への金銭負担")
    findings += check_misc(text, name)
    catch = extract_catch_copy(text)
    if catch:
        findings += [Finding(f.target, f.severity, f.code, f.message, f.hint)
                     for f in check_wage_in_copy(catch, name)]
    title = extract_job_title(text)
    if title is not None:
        findings += [Finding(f.target, f.severity, f.code, f.message, f.hint)
                     for f in check_title_words(title, name)]
    return findings


def shingles(text: str, size: int = 12) -> set[str]:
    normalised = re.sub(r"[\s　、。・！？\-—「」『』（）()]+", "", text)
    if len(normalised) < size:
        return {normalised} if normalised else set()
    return {normalised[i:i + size] for i in range(len(normalised) - size + 1)}


def check_duplicates(texts: dict[str, str], threshold: float) -> list[Finding]:
    """原稿の使い回しは媒体の重複判定に触れ、両方の掲載順位を下げる。"""
    findings = []
    names = sorted(texts)
    grams = {name: shingles(texts[name]) for name in names}
    for i, left in enumerate(names):
        for right in names[i + 1:]:
            a, b = grams[left], grams[right]
            if not a or not b:
                continue
            similarity = len(a & b) / len(a | b)
            if similarity >= threshold:
                findings.append(Finding(
                    left, WARN, "duplicate",
                    f"{right} と本文が {similarity:.0%} 一致",
                    "職種・訴求・1 日の流れを求人ごとに書き分ける",
                ))
    return findings


def collect(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted(path.rglob("*.md")))
        else:
            files.append(path)
    return files


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="求人原稿の法令・掲載品質チェック")
    parser.add_argument("paths", nargs="+", help="原稿ファイルまたはディレクトリ")
    parser.add_argument("--min-wage", type=int, default=None, help="地域別最低賃金（時給・円）")
    parser.add_argument("--duplicate-threshold", type=float, default=0.6, help="重複とみなす一致率（既定 0.6）")
    parser.add_argument("--json", action="store_true", help="JSON で出力する")
    args = parser.parse_args(argv)

    files = collect(args.paths)
    missing = [str(f) for f in files if not f.is_file()]
    if missing:
        print(f"ファイルがない: {', '.join(missing)}", file=sys.stderr)
        return 2
    if not files:
        print("対象ファイルがない", file=sys.stderr)
        return 2

    findings: list[Finding] = []
    texts: dict[str, str] = {}
    for path in files:
        findings += lint(path, args.min_wage)
        texts[str(path)] = strip_code_fences(path.read_text(encoding="utf-8"))
    if len(texts) > 1:
        findings += check_duplicates(texts, args.duplicate_threshold)

    errors = [f for f in findings if f.severity == ERROR]
    warnings = [f for f in findings if f.severity == WARN]

    if args.json:
        print(json.dumps({
            "files": len(files),
            "errors": len(errors),
            "warnings": len(warnings),
            "findings": [asdict(f) for f in findings],
        }, ensure_ascii=False, indent=2))
    else:
        for path in sorted({f.file for f in findings}):
            print(f"\n{path}")
            for finding in findings:
                if finding.file != path:
                    continue
                mark = "ERROR" if finding.severity == ERROR else "WARN "
                print(f"  {mark} [{finding.code}] {finding.message}")
                if finding.hint:
                    print(f"        → {finding.hint}")
        print(f"\n{len(files)} ファイル / エラー {len(errors)} 件 / 警告 {len(warnings)} 件")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
