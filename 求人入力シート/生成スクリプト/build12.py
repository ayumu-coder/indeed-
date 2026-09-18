# -*- coding: utf-8 -*-
"""v12: 求人キャッチコピーから給与額を除去（ハウスルール準拠）。

対象4行（v11）：
  - 税務スタッフ（経験者向け）  「年収452万〜688万」
  - Alpha株式会社              「月給21万〜41万」
  - 株式会社クリエイトmk        「月給35万円／年収450〜500万円」
  - 株式会社ピアルカ            「年収400〜450万円」
給与額は給与欄および募集要項（給与の補足）で扱う。他の列は変更しない。

あわせて 会社別/ の CSV を v12 から再生成する。
"""
import csv, os, re, unicodedata

BASE = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(BASE, "求人入力シート_v11_全10求人.csv")
OUT_ALL = os.path.join(BASE, "求人入力シート_v12_全10求人.csv")
OUT_DIR = os.path.join(BASE, "会社別")

# 職種名の一部 -> 新しいキャッチコピー
REWRITES = {
    "税務スタッフ（兼 財務コンサルタント）／会計事務所経験者採用":
        "【名古屋・伏見駅 徒歩2分】記帳代行・一次監査は内勤チームが対応／年休128日・フレックス・リモート可。経営者との対話に時間を使える会計事務所経験者ポジション",
    "携帯ショップ・家電量販店の接客販売スタッフ":
        "【東海三県・希望エリアで配属】未経験歓迎◎販売ノルマなし＋インセンティブあり／残業ほぼゼロ・完全週休2日制の接客販売スタッフ",
    "法人営業（生産設備・搬送設備）":
        "【名古屋・南区】年間休日116日・直行直帰OK／新規開拓ゼロからではない既存取引先中心の法人営業。現場経験がそのまま活きる仕事です",
    "営業・管理スタッフ（総合職）":
        "【蒲郡・名古屋・春日井】組織改革のキーマン募集！空き家問題に挑む社会貢献性の高い営業／年休約120日・土日祝休み・独立／FCオーナー支援あり",
}

# 給与額らしき表現の検出（検証用）
MONEY = re.compile(r"(月給|年収|時給|日給|年俸)|[0-9][0-9,\.]*\s*(万円|円)")


def normalize(s: str) -> str:
    """全角数字などを畳んでから検証するための正規化。"""
    return unicodedata.normalize("NFKC", s)


def load(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    return rows[0], [dict(zip(rows[0], r)) for r in rows[1:]]


def dump(path, header, records):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        for d in records:
            w.writerow({k: d.get(k, "") for k in header})


def company_slug(record):
    """会社別ファイル名。社名掲載不可の行はまとめて1ファイルにする。"""
    name = record["会社名"].strip()
    return name if name else "社名掲載不可_税務会計3職種"


def main():
    header, records = load(SRC)

    applied = set()
    for rec in records:
        for key, copy in REWRITES.items():
            if key in rec["職種名"]:
                rec["求人キャッチコピー"] = copy
                applied.add(key)
    missing = set(REWRITES) - applied
    if missing:
        raise SystemExit(f"書き換え対象が見つかりません: {missing}")

    # 全行のキャッチコピーに給与額が残っていないことを検証
    offenders = [
        (rec["会社名"] or "(社名掲載不可)", rec["職種名"][:30], rec["求人キャッチコピー"])
        for rec in records
        if MONEY.search(normalize(rec["求人キャッチコピー"]))
    ]
    if offenders:
        raise SystemExit("キャッチコピーに給与額が残っています: " + repr(offenders))

    dump(OUT_ALL, header, records)

    # 会社別を再生成（既存ファイルは作り直す）
    for old in os.listdir(OUT_DIR):
        if old.endswith(".csv"):
            os.remove(os.path.join(OUT_DIR, old))
    groups = {}
    for rec in records:
        groups.setdefault(company_slug(rec), []).append(rec)
    for slug, recs in groups.items():
        dump(os.path.join(OUT_DIR, f"求人入力シート_{slug}.csv"), header, recs)

    print(f"wrote {OUT_ALL} ({len(records)} rows)")
    for slug, recs in sorted(groups.items()):
        print(f"  会社別/求人入力シート_{slug}.csv ({len(recs)} rows)")


if __name__ == "__main__":
    main()
