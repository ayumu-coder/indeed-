"""求人原稿の判定に共通で使う語彙と小道具。

原稿 md を見る lint_posting.py と、アップロード用シートを見る lint_sheet.py が
同じ NG 表現の定義を共有するために切り出してある。片方だけ直して判定がずれるのを防ぐ。
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

ERROR = "error"
WARN = "warn"


@dataclass(frozen=True)
class Finding:
    target: str
    severity: str
    code: str
    message: str
    hint: str = ""


def visual_width(text: str) -> float:
    """全角換算の文字数。媒体の表示幅は文字数ではなく幅で決まる。"""
    return sum(2 if unicodedata.east_asian_width(ch) in "WFA" else 1 for ch in text) / 2


# --- 年齢 ---------------------------------------------------------------
# 労働施策総合推進法 9 条。例外事由の明記があれば警告に落とす。
AGE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"(?<![0-9])[0-9]{2}\s*歳\s*(?:以上|以下|未満|まで)", "年齢の上限・下限"),
    (r"[0-9]{2}\s*[〜~ー-]\s*[0-9]{2}\s*歳", "年齢レンジ"),
    (r"若手(?:の方)?(?:歓迎|募集|限定)", "若年層の限定"),
    (r"(?:シニア|中高年)(?:の方)?(?:歓迎|募集|限定)", "年齢層の限定"),
    (r"新卒(?:のみ|限定)", "新卒限定"),
)
AGE_EXEMPTION_HINTS = (
    "例外事由",
    "定年",
    "労働基準法",
    "長期勤続によるキャリア形成",
    "長期キャリア形成",
    "技能・ノウハウの継承",
)

# 「20代活躍中」「20代30代スタッフ多数活躍中」は在籍者の構成を示す表現で、
# 応募を年齢で制限するものではないため違反ではない。実データでも多用されている。
# ただし募集条件の文脈に置くと制限と読まれうるので、警告として一度目に入れる。
AGE_SOFT_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"[0-9]{2}\s*代[^\n。]{0,8}?(?:活躍|多数)", "年齢層に触れる表現"),
)

# --- 性別 ---------------------------------------------------------------
GENDER_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"営業マン|セールスマン", "営業職 と書く"),
    (r"看護婦|看護夫", "看護師 と書く"),
    (r"保母|保父", "保育士 と書く"),
    (r"ウェイトレス|ウェイター", "ホールスタッフ と書く"),
    (r"スチュワーデス", "客室乗務員 と書く"),
    (r"(?:女性|男性|婦人)(?:の方)?(?:限定|のみ|歓迎|活躍中|活躍)", "性別を外して「20代・30代活躍中」と書く"),
    (r"(?:男女)いずれか", "性別による限定は書けない"),
)

# --- 身体的要件・属性 ---------------------------------------------------
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

# 日本語能力の要件。業務上の必要性を超えると国籍による間接差別になりうる。
LANGUAGE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"日本語能力試験\s*N1", "N1 は最上位。業務上そこまで必要か（N2・N3 で足りないか）確認する"),
)

# 職種名に使わない語（2026-09-24 追加）。キャッチコピーや本文は対象外。
# 半角 OK と全角 ＯＫ だけを見る。小文字 "ok" まで拾うと Book などに誤反応するため。
NG_IN_TITLE_RE = re.compile(r"OK|ＯＫ|歓迎")

# 「OK」「歓迎」を外すときの言い換え。house-style.md の表と揃えてある。
TITLE_LEAD_ALTERNATIVES = (
    "未経験から", "経験不問", "未経験スタート", "資格不要", "業界未経験から",
    "内勤中心", "訪問なし", "もくもく作業", "駅チカ", "シフト相談",
)


def check_title_words(text: str, target: str, label: str = "職種名") -> list[Finding]:
    """職種名に OK・歓迎 が入っていないかを見る。"""
    found = NG_IN_TITLE_RE.search(text)
    if found is None:
        return []
    return [Finding(
        target, WARN, "title-word",
        f"{label}に「{found.group(0)}」が入っている",
        "言い換え候補: " + " / ".join(TITLE_LEAD_ALTERNATIVES[:5]) + " ほか（house-style.md）",
    )]


# 箇条書きの体裁（2026-09-24 追加）。■ と ✔ の項目どうしは空行で離さない。
# 空行はセクションの区切り（＝＝＝ の罫線）と見出し（【】《》）の前後にだけ置く。
BULLET_PREFIX = ("■", "✔")
SECTION_MARKERS = ("＝", "─", "✦", "【", "《", "◆", "＜")


def _starts_bullet(line: str) -> bool:
    return line.lstrip().startswith(BULLET_PREFIX)


def check_bullet_spacing(text: str, target: str, label: str = "本文") -> list[Finding]:
    """■ / ✔ の項目と項目のあいだに空行が入っていないかを見る。

    項目に説明の行がぶら下がっている場合も拾う。空行のうしろが ■ / ✔ で、
    空行から上へさかのぼる途中に ■ / ✔ の行があれば、項目どうしが離れている。
    見出しや罫線に当たった時点で打ち切るので、セクションの区切りは対象にしない。
    """
    lines = text.split("\n")
    findings = []
    for i, line in enumerate(lines):
        if line.strip() or i + 1 >= len(lines):
            continue
        nxt = lines[i + 1]
        if not _starts_bullet(nxt):
            continue
        for back in range(i - 1, -1, -1):
            prev = lines[back]
            if not prev.strip() or prev.lstrip().startswith(SECTION_MARKERS):
                break
            if _starts_bullet(prev):
                findings.append(Finding(
                    target, WARN, "bullet-spacing",
                    f"{label}の箇条書きに空行が入っている: "
                    f"「{prev.lstrip()[:18]}」と「{nxt.lstrip()[:18]}」のあいだ",
                    "■ と ✔ の項目どうしは続けて書く。空行は罫線と見出しの前後だけ",
                ))
                break
    return findings


PLACEHOLDER_RE = re.compile(r"\{\{\s*(?!要確認)([^}]+?)\s*\}\}")
UNRESOLVED_RE = re.compile(r"\{\{\s*要確認[:：]?\s*([^}]*?)\s*\}\}")

OVERTIME_HOURS_RE = re.compile(r"残業[^\n。]{0,12}?[0-9０-９][0-9０-９．.]*\s*時間")

# キャッチコピーに書かれた給与額。給与欄と二重に書くと、片方だけ改定されたときに
# 食い違って誤認表示になる。拠点ごとに給与が違う案件では、全行同一のキャッチコピーに
# 正しい額を書きようがない。
WAGE_IN_COPY_RE = re.compile(
    r"(?:月給|年収|時給|日給|週給|年俸|月収)[^\n]{0,6}?[0-9０-９][0-9０-９,，.．]*\s*(?:万|千)?円"
    r"|[0-9０-９][0-9０-９,，.．]*\s*(?:万|千)?円[^\n]{0,4}?(?:〜|~|以上|スタート)"
)


def check_wage_in_copy(text: str, target: str, label: str = "キャッチコピー") -> list[Finding]:
    """キャッチコピーに給与額が入っていないかを見る。"""
    found = WAGE_IN_COPY_RE.search(text)
    if found is None:
        return []
    return [Finding(
        target, WARN, "copy-wage",
        f"{label}に給与額が入っている: 「{found.group(0)}」",
        "給与は給与欄と本文で扱う。キャッチコピーには金額以外の訴求を置く",
    )]


def match_patterns(
    text: str,
    target: str,
    patterns: tuple[tuple[str, str], ...],
    code: str,
    severity: str,
    label: str,
) -> list[Finding]:
    findings = []
    for pattern, note in patterns:
        found = re.search(pattern, text)
        if found:
            findings.append(Finding(target, severity, code, f"{label}: 「{found.group(0)}」", note))
    return findings


def check_age_expressions(text: str, target: str) -> list[Finding]:
    """年齢表現。例外事由が併記されていれば適法なので警告に落とす。"""
    hits = match_patterns(text, target, AGE_PATTERNS, "age-limit", ERROR, "年齢制限の表現")
    if hits and any(hint in text for hint in AGE_EXEMPTION_HINTS):
        hits = [
            Finding(
                f.target, WARN, f.code,
                f.message + "（例外事由の記載あり）",
                "期間の定めのない契約かつ職務経験不問であることを確認する。経験を要件にすると例外事由 3 号イは成立しない",
            )
            for f in hits
        ]
    return hits + match_patterns(text, target, AGE_SOFT_PATTERNS, "age-soft", WARN, "年齢層に触れる表現")


def check_discrimination(text: str, target: str) -> list[Finding]:
    """性別・身体・属性・言語要件をまとめて当てる。"""
    return (
        match_patterns(text, target, GENDER_PATTERNS, "gender", ERROR, "性別を限定する表現")
        + match_patterns(text, target, BODY_PATTERNS, "physical", ERROR, "身体的要件")
        + match_patterns(text, target, NATIONALITY_PATTERNS, "attribute", ERROR, "属性による限定")
        + match_patterns(text, target, APPLICANT_COST_PATTERNS, "applicant-cost", ERROR, "応募者への金銭負担")
        + match_patterns(text, target, LANGUAGE_PATTERNS, "language", WARN, "日本語能力の要件")
    )


def check_placeholders(text: str, target: str) -> list[Finding]:
    findings = []
    for found in UNRESOLVED_RE.finditer(text):
        findings.append(Finding(target, WARN, "unresolved", f"未確認のまま: {found.group(1) or '項目不明'}", "入稿前に確定させる"))
    for found in PLACEHOLDER_RE.finditer(text):
        findings.append(Finding(target, ERROR, "placeholder", f"プレースホルダが残っている: {{{{{found.group(1)}}}}}"))
    return findings


def render(findings: list[Finding], unit: str, count: int) -> str:
    """人が読む形に整える。JSON 出力は呼び出し側が組み立てる。"""
    lines = []
    for target in sorted({f.target for f in findings}):
        lines.append(f"\n{target}")
        for finding in findings:
            if finding.target != target:
                continue
            mark = "ERROR" if finding.severity == ERROR else "WARN "
            lines.append(f"  {mark} [{finding.code}] {finding.message}")
            if finding.hint:
                lines.append(f"        → {finding.hint}")
    errors = sum(f.severity == ERROR for f in findings)
    warnings = len(findings) - errors
    lines.append(f"\n{count} {unit} / エラー {errors} 件 / 警告 {warnings} 件")
    return "\n".join(lines)
