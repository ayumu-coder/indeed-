#!/usr/bin/env python3
"""検品・梱包 4 社 333 件の求人入力シートをリライトして出力する.

使い方:
    python3 scripts/generate_rewrite.py [--input PATH] [--output PATH] [--summary PATH]

変更する列 (0 始まりのインデックス):
    C  (2)  職種名
    E  (4)  求人キャッチコピー
    AT (45) 募集要項（仕事内容）
    AU (46) 募集要項（アピールポイント）
    BB (53) 募集要項（待遇・福利厚生）
    BC (54) 募集要項（その他）
それ以外の列は 1 文字も変更しない。
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import area_notes  # noqa: E402
from content_library import CATCH_PREFIX, OTHER_PATTERNS, STYLES, CompanyStyle  # noqa: E402

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
DEFAULT_INPUT = BASE / "input" / "求人入力シート_元データ_20260930.csv"
DEFAULT_OUTPUT = BASE / "求人入力シート_検品梱包4社_リライト_20260930.csv"
DEFAULT_SUMMARY = BASE / "scripts" / "generation_summary.json"

COL_COMPANY = 1
COL_TITLE = 2
COL_CATCH = 4
COL_LOCATION = 6
COL_JOB = 45
COL_APPEAL = 46
COL_BENEFITS = 53
COL_OTHER = 54

TITLE_SEP = "｜"
PATTERN_KEYS = list(OTHER_PATTERNS.keys())

JOB_BASES = (4, 3, 4, 3, 3, 2, 2)      # intro, schedule, items, training, environment, local, closing
JOB_STRIDE = 617
APPEAL_BASES = (2, 3, 3, 2, 3, 3, 2, 2)  # open, beginner, holiday, light, env, company, local, close
APPEAL_STRIDE = 533


@dataclass(frozen=True)
class RowContext:
    index: int              # 0 始まりのデータ行番号
    company: str
    style: CompanyStyle
    site: str               # 現職種名の末尾要素 (会社名の後ろ全部)
    location: str           # G 列
    pref: str
    city: str
    access: str
    character: str
    seq: int                # 会社内の通し番号 (0 始まり)
    occurrence: int         # 同一 (会社, 拠点名) の何回目か (0 始まり)


def read_csv(path: Path) -> list[list[str]]:
    raw = path.read_bytes()
    if not raw.startswith(b"\xef\xbb\xbf"):
        raise SystemExit(f"入力が UTF-8 BOM ではありません: {path}")
    return list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))


def write_csv(path: Path, rows: list[list[str]]) -> None:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    path.write_bytes(b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8"))


def split_title(title: str, company: str) -> str:
    """「【未経験】検品・梱包作業/会社名/拠点名」から拠点名 (会社名より後ろ全部) を返す."""
    marker = "/" + company + "/"
    pos = title.find(marker)
    if pos < 0:
        raise ValueError(f"職種名に会社名が見つかりません: {title!r}")
    site = title[pos + len(marker):]
    if not site:
        raise ValueError(f"拠点名が空です: {title!r}")
    return site


def mixed_radix(code: int, bases: tuple[int, ...]) -> tuple[int, ...]:
    digits = []
    for b in bases:
        digits.append(code % b)
        code //= b
    return tuple(digits)


def product(bases: tuple[int, ...]) -> int:
    n = 1
    for b in bases:
        n *= b
    return n


def build_contexts(rows: list[list[str]]) -> list[RowContext]:
    seq_counter: Counter[str] = Counter()
    occ_counter: Counter[tuple[str, str]] = Counter()
    ctxs: list[RowContext] = []
    for i, r in enumerate(rows):
        company = r[COL_COMPANY]
        style = STYLES.get(company)
        if style is None:
            raise ValueError(f"未知の会社名: {company!r} (行 {i + 2})")
        site = split_title(r[COL_TITLE], company)
        loc = r[COL_LOCATION]
        access, character = area_notes.lookup(loc)
        ctx = RowContext(
            index=i,
            company=company,
            style=style,
            site=site,
            location=loc,
            pref=area_notes.prefecture(loc),
            city=area_notes.city_label(loc),
            access=access,
            character=character,
            seq=seq_counter[company],
            occurrence=occ_counter[(company, site)],
        )
        seq_counter[company] += 1
        occ_counter[(company, site)] += 1
        ctxs.append(ctx)
    return ctxs


def disambiguate_site(ctx: RowContext) -> tuple[str, str]:
    """2 回目以降の同一拠点名に勤務地情報を添える. 戻り値: (拠点表記, 適用ルール)."""
    if ctx.occurrence == 0:
        return ctx.site, "-"
    if ctx.city not in ctx.site:
        return f"{ctx.site}（{ctx.city}）", "市区町村を付記"
    if ctx.pref not in ctx.site:
        return f"{ctx.site}（{ctx.pref}）", "拠点名が市区町村そのもののため都道府県を付記"
    return ctx.city, "拠点名が都道府県＋市区町村のため市区町村のみ"


def make_title(ctx: RowContext, site_label: str) -> str:
    return TITLE_SEP.join(["未経験", "検品・梱包", ctx.company, site_label])


def fill(template: str, ctx: RowContext) -> str:
    worksite = ctx.style.worksite.format(site=ctx.site, city=ctx.city, pref=ctx.pref)
    return template.format(
        city=ctx.city, pref=ctx.pref, site=ctx.site, worksite=worksite,
        access=ctx.access, character=ctx.character,
    )


def make_catch(ctx: RowContext, used: set[str]) -> str:
    tails = ctx.style.catch_tails
    n = len(tails)
    for k in range(n):
        t = tails[(ctx.seq * 5 + k) % n]
        text = CATCH_PREFIX + fill(t, ctx)
        if text not in used:
            used.add(text)
            return text
    raise RuntimeError(f"キャッチコピーを一意にできません: 行 {ctx.index + 2}")


def make_job(ctx: RowContext) -> tuple[str, tuple[int, ...]]:
    s = ctx.style
    code = (ctx.seq * JOB_STRIDE) % product(JOB_BASES)
    d = mixed_radix(code, JOB_BASES)
    parts = [
        s.intro[d[0]],
        s.schedule[d[1]],
        s.items[d[2]],
        s.training[d[3]],
        s.environment[d[4]],
        s.local[d[5]],
        s.closing[d[6]],
    ]
    return "\n\n".join(fill(p, ctx) for p in parts), d


def make_appeal(ctx: RowContext) -> tuple[str, tuple[int, ...]]:
    s = ctx.style
    code = (ctx.seq * APPEAL_STRIDE) % product(APPEAL_BASES)
    d = mixed_radix(code, APPEAL_BASES)
    parts = [
        s.appeal_open[d[0]],
        s.appeal_beginner[d[1]],
        s.appeal_holiday[d[2]],
        s.appeal_light[d[3]],
        s.appeal_env[d[4]],
        s.appeal_company[d[5]],
        s.appeal_local[d[6]],
        s.appeal_close[d[7]],
    ]
    return "\n\n".join(fill(p, ctx) for p in parts), d


def make_other(ctx: RowContext) -> str:
    return PATTERN_KEYS[ctx.seq % len(PATTERN_KEYS)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    ap.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    args = ap.parse_args()

    table = read_csv(args.input)
    header, rows = table[0], table[1:]
    if len(header) != 66:
        raise SystemExit(f"列数が 66 ではありません: {len(header)}")

    ctxs = build_contexts(rows)
    used_catch: set[str] = set()
    used_title: set[str] = set()
    out_rows: list[list[str]] = [list(header)]
    disambiguated: list[dict[str, str]] = []
    pattern_rows: dict[str, list[int]] = defaultdict(list)
    pattern_by_company: dict[str, Counter[str]] = defaultdict(Counter)
    pattern_by_pref: dict[str, Counter[str]] = defaultdict(Counter)
    job_combos: dict[str, set[tuple[int, ...]]] = defaultdict(set)
    appeal_combos: dict[str, set[tuple[int, ...]]] = defaultdict(set)

    for r, ctx in zip(rows, ctxs):
        new = list(r)
        site_label, rule = disambiguate_site(ctx)
        title = make_title(ctx, site_label)
        if title in used_title:
            raise RuntimeError(f"職種名が重複しました: {title}")
        used_title.add(title)
        if rule != "-":
            disambiguated.append({
                "row": str(ctx.index + 2), "company": ctx.company, "site": ctx.site,
                "location": ctx.location, "title": title, "rule": rule,
            })
        job, jd = make_job(ctx)
        appeal, ad = make_appeal(ctx)
        pattern = make_other(ctx)

        new[COL_TITLE] = title
        new[COL_CATCH] = make_catch(ctx, used_catch)
        new[COL_JOB] = job
        new[COL_APPEAL] = appeal
        new[COL_BENEFITS] = ctx.style.benefits
        new[COL_OTHER] = OTHER_PATTERNS[pattern]
        out_rows.append(new)

        pattern_rows[pattern].append(ctx.index + 2)
        pattern_by_company[ctx.company][pattern] += 1
        pattern_by_pref[ctx.pref][pattern] += 1
        job_combos[ctx.company].add(jd)
        appeal_combos[ctx.company].add(ad)

    write_csv(args.output, out_rows)
    summary = {
        "rows": len(rows),
        "title_disambiguated": disambiguated,
        "other_pattern_rows": {k: v for k, v in sorted(pattern_rows.items())},
        "other_pattern_by_company": {c: dict(sorted(v.items())) for c, v in pattern_by_company.items()},
        "other_pattern_by_pref": {p: dict(sorted(v.items())) for p, v in pattern_by_pref.items()},
        "job_variant_combos_distinct": {c: len(v) for c, v in job_combos.items()},
        "appeal_variant_combos_distinct": {c: len(v) for c, v in appeal_combos.items()},
    }
    args.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {args.output} ({len(rows)} rows)")
    print(f"wrote {args.summary}")
    print(f"title disambiguated: {len(disambiguated)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
