# -*- coding: utf-8 -*-
"""東京 23 区 × 4 営業職（モバイル／ルート／反響／新規開拓）= 92 行を組み立てる。

4 列（キャッチコピー・タイトル・仕事内容・アピールポイント）は 92 行すべて別文面。
組み合わせを行番号から決めるので、何度生成しても同じ結果になる。

ブロックの選び方：23 行の自由度は (r, q) = (w % 5, w // 5) の 2 つしかない。
6 つのブロックに r / q / (r + k·q) mod 5（k = 1〜4）という互いに異なる一次式を
割り当てると、同一職種の任意の 2 行で一致するブロックが必ず 1 個以下になる。

会社名・給与・勤務時間・休日・待遇は与えられていないので書かない。
書けば職業安定法 5 条の 3・65 条の虚偽の労働条件表示になる。
給与額は 4 列のどこにも入れない（「円」の文字自体を使わない）。

**職種の定義として言えることと、事業者ごとに違うことを分けている（jobs.py 参照）。**
反響営業の「テレアポ・飛び込みなし」は定義なので書ける。
新規開拓営業の手法とモバイル営業の販路は事業者ごとなので断定しない。
ノルマ・インセンティブ・直行直帰・社用車・資格手当もすべて断定しない。
"""
import csv, pathlib, sys, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from jobs import JOBS, JobSpec
from wards import WARDS

OUT = pathlib.Path('東京23区_モバイル_ルート_反響_新規開拓営業求人_20261002.csv')
HEADER = ["区", "職種", "駅名", "住所", "キャッチコピー", "タイトル", "仕事内容", "アピールポイント"]
CATCH_TAIL = ("♪", "◎", "！", "☆", "✨")
TITLE_HEAD = ("未経験から", "経験不問", "未経験スタート", "業界未経験から", "資格不要")

# --- 職種をまたいで共通のブロック（営業職全般に当てはまる内容） ---
SUPPORT = (
    ("✔ 入社後に商材を覚えていけます", "✔ 使う資料は用意されています",
     "✔ 分からないことはその場で確認できます", "✔ 一人で判断する場面は限られます"),
    ("✔ はじめから一人で任される作りではありません", "✔ 社内に確認してから回答できます",
     "✔ やり取りは記録として残します", "✔ 進んでいる案件はチームで共有します"),
    ("✔ 説明に使う資料が決まっています", "✔ 手続きの流れが決まっています",
     "✔ 記入もれは確認の手順で気づけます", "✔ 相談できる距離で働けます"),
    ("✔ 覚える範囲は担当する商材だけです", "✔ 1 日の流れが決まっています",
     "✔ 迷ったら確認してから進めます", "✔ チームで情報を共有します"),
    ("✔ 前任者の記録を見ながら進められます", "✔ 社内のフォーマットを使います",
     "✔ 判断に迷う内容は持ち帰れます", "✔ 一人で抱え込む作りではありません"),
)
CLOSE = (
    "まずはお気軽にご応募ください。",
    "気になる点はお気軽にお尋ねください。",
    "「話を聞いてみたい」だけのご応募もお待ちしています。",
    "ご不明な点はご応募後にご説明します。",
    "まずは仕事内容を知るところからで大丈夫です。",
)
APPEAL_FIT = (
    ("✔ 人と話すのが苦ではない方", "✔ 相手の話を聞くのが得意な方", "✔ 記録をこまめに残せる方"),
    ("✔ 決まった流れで進めたい方", "✔ 一つずつ覚えていきたい方", "✔ 予定を立てて動きたい方"),
    ("✔ 営業がはじめての方", "✔ 相談しながら進めたい方", "✔ コツコツ続けるのが得意な方"),
    ("✔ 聞かれたことに丁寧に答えたい方", "✔ 社内と連携して進めたい方", "✔ 段取りを考えるのが好きな方"),
    ("✔ 業界未経験から始めたい方", "✔ 商材を理解してから話したい方", "✔ 長く続けたい方"),
)
APPEAL_NOTE = (
    "✔ 経験・資格は必要ありません",
    "✔ 給与・勤務時間・休日・待遇の詳細は応募後にご案内します",
    "✔ 目標の立て方と評価の仕組みは選考の場でご説明します",
    "✔ 気になる点だけのお問い合わせもお受けします",
)


def width(s: str) -> float:
    return sum(2 if unicodedata.east_asian_width(c) in 'WFA' else 1 for c in s) / 2


def build_catch(spec: JobSpec, r: int, q: int, j: int) -> str:
    # 職種をまたぐ共通プールは j でずらす。j は職種内では定数なので、
    # 同一職種の「一致ブロックは 1 個以下」という性質は保たれる。
    return f'{spec.catch_lead[r]}◎{spec.catch_mid[q]}{CATCH_TAIL[(r + q + j) % 5]}'


def build_title(spec: JobSpec, ward: str, r: int, q: int, j: int) -> str:
    label = spec.title_labels[(r + q) % 4]
    title = f'{TITLE_HEAD[(r + j) % 5]}｜{label}｜{ward}'
    if width(title) > 30:
        return f'未経験から｜{spec.title_labels[1]}｜{ward}'
    return title


def build_body(spec: JobSpec, ward: str, station: str, address: str,
               r: int, q: int, j: int) -> str:
    l1, l2 = spec.hooks[r]
    a1, a2, ans = spec.asks[q]
    steps = spec.steps[(r + q) % 5]
    merits = spec.merits[(r + 2 * q) % 5]
    support = SUPPORT[(r + 3 * q + j) % 5]
    close = CLOSE[(r + 4 * q + 2 * j) % 5]
    return "\n".join([
        "✦・━━━━━━━━━━━━━━━・✦",
        f"＼{ward}で募集中／", l1, l2,
        "✦・━━━━━━━━━━━━━━━・✦",
        "", a1, a2, "", ans, "",
        "＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝",
        "【✧お仕事の内容✧】",
        "\n".join(steps), "",
        "＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝",
        "【✨この仕事のポイント✨】",
        "\n".join(merits), "",
        "＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝",
        "【✨はじめての方へ✨】",
        "\n".join(support), "",
        "＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝",
        "【✧勤務地✧】", "",
        f"{address}（{station}駅エリア）", "",
        "給与・勤務時間・休日・待遇の詳細は、",
        "ご応募後にあらためてご案内します。", close,
    ])


def build_appeal(spec: JobSpec, r: int, q: int, j: int) -> str:
    # (head, points) = (r, q) なので同一職種の 23 行すべてで異なる組になる
    lines = [spec.appeal_heads[r], ""]
    for title, text in spec.appeal_points[q]:
        lines += [f"✅{title}", text, ""]
    lines += ["＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝", "《✼向いている方✼》"]
    lines += list(APPEAL_FIT[(r + q + 3 * j) % 5])
    lines += ["", "＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝", "《✼応募について✼》"]
    lines += list(APPEAL_NOTE)
    return "\n".join(lines)


def main() -> int:
    rows: list[list[str]] = []
    for j, spec in enumerate(JOBS):
        for w, (ward, station, address, _confident) in enumerate(WARDS):
            r, q = w % 5, w // 5
            rows.append([
                ward, spec.name, station, address,
                build_catch(spec, r, q, j),
                build_title(spec, ward, r, q, j),
                build_body(spec, ward, station, address, r, q, j),
                build_appeal(spec, r, q, j),
            ])

    with OUT.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(HEADER)
        writer.writerows(rows)

    cols = {name: [row[k] for row in rows] for k, name in enumerate(HEADER)}
    print(f'{len(rows)} 行 / {len(WARDS)} 区 × {len(JOBS)} 職種')
    for name in ('キャッチコピー', 'タイトル', '仕事内容', 'アピールポイント'):
        print(f'  {name}: ユニーク {len(set(cols[name]))} / {len(cols[name])}')
    print(f'  タイトル幅 {min(map(width, cols["タイトル"])):.0f}〜{max(map(width, cols["タイトル"])):.0f} 全角')
    print(f'  キャッチ幅 {min(map(width, cols["キャッチコピー"])):.0f}〜{max(map(width, cols["キャッチコピー"])):.0f} 全角')
    return 0


if __name__ == '__main__':
    sys.exit(main())
