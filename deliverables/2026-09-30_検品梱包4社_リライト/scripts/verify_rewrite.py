#!/usr/bin/env python3
"""リライト結果の機械検証.

検証項目:
  1. 列数 66・行数 333 が元 CSV と一致、UTF-8 BOM、CRLF
  2. 変更対象 6 列 (C, E, AT, AU, BB, BC) 以外の全列が元と完全一致
  3. 職種名 333 件が一意で「未経験｜検品・梱包｜会社名｜拠点名」形式
  4. キャッチコピー 333 件が一意で「20～30代活躍中◎」で始まる
  5. 仕事内容 1000 文字以上・アピール 500 文字以上、かつ 333 件すべて一意
  6. 禁止語なし: 給与額 (円/万円/月給/時給/年収)、OK/歓迎、性別・国籍表現、年代表現 (キャッチ冒頭を除く)、
     他社名、【要確認】
  7. 1 行目が記号だけの行がない、同一記号の箇条書き項目間に空行がない
  8. その他 (BC) が 5 パターンのいずれかで、全パターンに共通要素 (カジュアル面談 / STEP1〜3 / 入社日相談) を含む
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from content_library import CATCH_PREFIX, OTHER_PATTERNS, STYLES  # noqa: E402

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
DEFAULT_INPUT = BASE / "input" / "求人入力シート_元データ_20260930.csv"
DEFAULT_OUTPUT = BASE / "求人入力シート_検品梱包4社_リライト_20260930.csv"

COL_COMPANY, COL_TITLE, COL_CATCH, COL_JOB, COL_APPEAL, COL_BENEFITS, COL_OTHER = 1, 2, 4, 45, 46, 53, 54
CHANGED = {COL_TITLE, COL_CATCH, COL_JOB, COL_APPEAL, COL_BENEFITS, COL_OTHER}
COLNAME = {COL_TITLE: "職種名(C)", COL_CATCH: "キャッチ(E)", COL_JOB: "仕事内容(AT)", COL_APPEAL: "アピール(AU)",
           COL_BENEFITS: "福利厚生(BB)", COL_OTHER: "その他(BC)"}

MIN_JOB = 1000
MIN_APPEAL = 500

RE_MONEY = re.compile(r"円|月給|時給|日給|年収|万\s*[0-9０-９]")
RE_OKW = re.compile(r"OK|ＯＫ|歓迎")
RE_GENDER = re.compile(r"男性|女性|男女|主婦|主夫|ママ|パパ|女子|男子|性別|外国人|外国籍|国籍|日本人")
RE_AGE = re.compile(r"[0-9０-９]+代|歳|年齢|若手|若い|シニア|学生")
RE_TODO = re.compile(r"【要確認】")
BULLETS = ("■", "✔", "✅", "・", "✧", "◎", "▶", "◆")
COMPANY_ALIASES: dict[str, list[str]] = {
    "日本マニュファクチャリングサービス株式会社": ["日本マニュファクチャリングサービス", "nms", "NMS"],
    "株式会社エイジェック": ["エイジェック", "AGEKKE", "agekke"],
    "株式会社テクノ・サービス": ["テクノ・サービス", "テクノサービス", "スタッフサービス", "リクルート"],
    "株式会社BREXA Technology": ["BREXA", "ブレクサ", "アウトソーシングテクノロジー", "OSテクノロジー"],
}
RE_LETTER = re.compile(r"[0-9A-Za-z０-９Ａ-Ｚａ-ｚぁ-んァ-ヶ一-龠々]")


def read(path: Path) -> tuple[bytes, list[list[str]]]:
    raw = path.read_bytes()
    return raw, list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))


def visible_len(text: str) -> int:
    return len(text.replace("\n", "").replace("\r", ""))


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.info: list[str] = []

    def err(self, msg: str) -> None:
        self.errors.append(msg)

    def ok(self, msg: str) -> None:
        self.info.append(msg)


def check_bullets(text: str) -> list[str]:
    """同一記号の箇条書き項目間に空行がある箇所を返す."""
    lines = text.split("\n")
    problems = []
    for i, line in enumerate(lines):
        if line.strip():
            continue
        prev = next((l for l in reversed(lines[:i]) if l.strip()), None)
        nxt = next((l for l in lines[i + 1:] if l.strip()), None)
        if prev is None or nxt is None:
            continue
        for b in BULLETS:
            if prev.startswith(b) and nxt.startswith(b):
                problems.append(f"'{prev[:12]}' と '{nxt[:12]}' の間に空行")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = ap.parse_args()
    rep = Report()

    raw_in, src = read(args.input)
    raw_out, out = read(args.output)

    # 1. 形式
    if not raw_out.startswith(b"\xef\xbb\xbf"):
        rep.err("出力に UTF-8 BOM がありません")
    if b"\r\n" not in raw_out:
        rep.err("出力の改行が CRLF ではありません")
    if len(out) != len(src):
        rep.err(f"行数不一致: 元 {len(src)} / 出力 {len(out)}")
    if out[0] != src[0]:
        rep.err("ヘッダー行が元と一致しません")
    bad_cols = [i + 1 for i, r in enumerate(out) if len(r) != 66]
    if bad_cols:
        rep.err(f"列数が 66 でない行: {bad_cols[:10]}")
    rep.ok(f"形式: {len(out) - 1} データ行 × {len(out[0])} 列, BOM あり, CRLF")

    # 2. 非対象列の同一性
    diff = Counter()
    for i, (a, b) in enumerate(zip(src[1:], out[1:]), start=2):
        for c in range(66):
            if c in CHANGED:
                continue
            if a[c] != b[c]:
                diff[src[0][c]] += 1
    if diff:
        rep.err(f"変更対象外の列に差分: {dict(diff)}")
    else:
        rep.ok("変更対象外 60 列は元と完全一致")

    rows = out[1:]
    n = len(rows)

    # 3. 職種名
    titles = [r[COL_TITLE] for r in rows]
    if len(set(titles)) != n:
        dup = [t for t, c in Counter(titles).items() if c > 1]
        rep.err(f"職種名の重複 {len(dup)} 件: {dup[:5]}")
    for i, r in enumerate(rows, start=2):
        parts = r[COL_TITLE].split("｜")
        if len(parts) != 4 or parts[0] != "未経験" or parts[1] != "検品・梱包" or parts[2] != r[COL_COMPANY] or not parts[3]:
            rep.err(f"行{i}: 職種名の形式が不正: {r[COL_TITLE]}")
    rep.ok(f"職種名: {len(set(titles))} 件一意, 形式チェック済")

    # 4. キャッチ
    catches = [r[COL_CATCH] for r in rows]
    if len(set(catches)) != n:
        rep.err("キャッチコピーに重複あり")
    for i, c in enumerate(catches, start=2):
        if not c.startswith(CATCH_PREFIX):
            rep.err(f"行{i}: キャッチコピーが '{CATCH_PREFIX}' で始まらない: {c}")
        if len(c) == len(CATCH_PREFIX):
            rep.err(f"行{i}: キャッチコピーの後半が空")
    rep.ok(f"キャッチコピー: {len(set(catches))} 件一意, 全件が '{CATCH_PREFIX}' 始まり")

    # 5. 文字数と一意性
    jobs = [r[COL_JOB] for r in rows]
    appeals = [r[COL_APPEAL] for r in rows]
    short_job = [(i + 2, visible_len(t)) for i, t in enumerate(jobs) if visible_len(t) < MIN_JOB]
    short_ap = [(i + 2, visible_len(t)) for i, t in enumerate(appeals) if visible_len(t) < MIN_APPEAL]
    if short_job:
        rep.err(f"仕事内容 {MIN_JOB} 文字未満: {short_job[:10]}")
    if short_ap:
        rep.err(f"アピール {MIN_APPEAL} 文字未満: {short_ap[:10]}")
    if len(set(jobs)) != n:
        rep.err("仕事内容に重複あり")
    if len(set(appeals)) != n:
        rep.err("アピールポイントに重複あり")
    jl = sorted(visible_len(t) for t in jobs)
    al = sorted(visible_len(t) for t in appeals)
    rep.ok(f"仕事内容: 一意 {len(set(jobs))} 件, 文字数 min {jl[0]} / median {jl[n // 2]} / max {jl[-1]}")
    rep.ok(f"アピール: 一意 {len(set(appeals))} 件, 文字数 min {al[0]} / median {al[n // 2]} / max {al[-1]}")

    # 6. 禁止語
    for i, r in enumerate(rows, start=2):
        others = [alias for comp, aliases in COMPANY_ALIASES.items() if comp != r[COL_COMPANY] for alias in aliases]
        for c in CHANGED:
            text = r[c]
            name = COLNAME[c]
            if RE_MONEY.search(text):
                rep.err(f"行{i} {name}: 給与額/金額表現 '{RE_MONEY.search(text).group()}'")
            if RE_OKW.search(text):
                rep.err(f"行{i} {name}: 'OK/歓迎' を含む")
            if RE_GENDER.search(text):
                rep.err(f"行{i} {name}: 性別/国籍表現 '{RE_GENDER.search(text).group()}'")
            age_text = text[len(CATCH_PREFIX):] if c == COL_CATCH else text
            if RE_AGE.search(age_text):
                rep.err(f"行{i} {name}: 年代表現 '{RE_AGE.search(age_text).group()}'")
            if RE_TODO.search(text):
                rep.err(f"行{i} {name}: 【要確認】が残っている")
            for alias in others:
                if alias in text:
                    rep.err(f"行{i} {name}: 他社名 '{alias}' を含む")
            # 7. 先頭行・箇条書き
            first = text.split("\n", 1)[0]
            if not RE_LETTER.search(first):
                rep.err(f"行{i} {name}: 1 行目が記号のみ: {first!r}")
            for p in check_bullets(text):
                rep.err(f"行{i} {name}: 箇条書き項目間の空行 ({p})")
    rep.ok("禁止語 (給与額 / OK・歓迎 / 性別・国籍 / 年代 / 他社名 / 【要確認】) なし")
    rep.ok("1 行目が記号のみの列なし, 同一記号の箇条書き項目間の空行なし")

    # 8. その他パターン
    pat_of = {v: k for k, v in OTHER_PATTERNS.items()}
    counts: Counter[str] = Counter()
    for i, r in enumerate(rows, start=2):
        p = pat_of.get(r[COL_OTHER])
        if p is None:
            rep.err(f"行{i}: その他が 5 パターンのいずれでもない")
        else:
            counts[p] += 1
    for k, v in OTHER_PATTERNS.items():
        for need in ("カジュアル面談", "STEP1", "STEP2", "STEP3", "入社日"):
            if need not in v:
                rep.err(f"その他パターン {k} に共通要素 '{need}' がない")
    rep.ok(f"その他: 5 パターン割当 {dict(sorted(counts.items()))}")

    # 9. 福利厚生が会社ごとに定義どおり
    for i, r in enumerate(rows, start=2):
        if r[COL_BENEFITS] != STYLES[r[COL_COMPANY]].benefits:
            rep.err(f"行{i}: 福利厚生が会社定義と一致しない")
    rep.ok("福利厚生: 会社ごとの定義と全行一致")

    print("== 検証結果 ==")
    for m in rep.info:
        print("OK  ", m)
    for m in rep.errors:
        print("NG  ", m)
    print(f"== エラー {len(rep.errors)} 件 ==")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
