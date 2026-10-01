# -*- coding: utf-8 -*-
"""11 都道府県 × 乗降人員トップ 5 駅。

10 都道府県は 2026-09-18 納品（deliverables/20260918-game-tester/stations180.py）の
上位 5 駅をそのまま引き継いだ。京都府はそのデータに無かったため新規に作成した。
いずれも出典未確認（知識ベース）。WebFetch が組織の egress ポリシーで全ドメイン
遮断されており、公式統計に当たれていない。
第 4 要素 False は町名まで特定できず市区町村どまりにしたもの。
同一駅に複数事業者が乗り入れる場合は 1 駅として扱い、重複させていない。
"""
import pathlib, sys

_GAME_TESTER = pathlib.Path(__file__).resolve().parent.parent / '20260918-game-tester'
sys.path.insert(0, str(_GAME_TESTER))
from stations180 import STATIONS as _ALL  # noqa: E402

# 依頼で指定された順に並べる
ORDER = ["京都府", "兵庫県", "三重県", "東京都", "神奈川県", "埼玉県",
         "千葉県", "大阪府", "愛知県", "北海道", "広島県"]

# 京都府のみ新規。(駅名, 住所, 主な事業者, 町名まで確度)
KYOTO = [
    ("京都",         "京都府京都市下京区東塩小路町", "JR西日本・JR東海・近鉄・地下鉄", True),
    ("四条・烏丸",   "京都府京都市下京区四条通烏丸", "地下鉄（四条）・阪急（烏丸）", False),
    ("京都河原町",   "京都府京都市下京区四条通河原町", "阪急", False),
    ("山科",         "京都府京都市山科区安朱桟敷町", "JR西日本・地下鉄・京阪（京阪山科）", True),
    ("丹波橋",       "京都府京都市伏見区京町",       "京阪・近鉄（近鉄丹波橋）", False),
]

STATIONS = {}
for pref in ORDER:
    STATIONS[pref] = KYOTO[:] if pref == "京都府" else list(_ALL[pref][:5])
