# -*- coding: utf-8 -*-
"""JoBins 共有求人 79件 → Indeed 求人入力シート（v14形式・67列）

出典：deliverables/2026-09-28_ジョビンズ/raw/<ID>.json
      （JoBins 公開API GET /api/public/jobins-shared-job/view/<ID> の生レスポンス）
      取得スクリプトは fetch18_jobins.py。

掲載しないもの（法令・ハウスルール）
 - 年齢・性別・国籍に関する表現（JoBinsのtitle・本文・応募条件に多数含まれるため行単位で除去）
 - 転職回数などの選考の内部基準
 - エージェント向けの記述（貴社／ご紹介ください／手数料など）
 - 本文・職種名・キャッチコピーへの給与額（給与欄と「募集要項（給与の補足）」のみ）

職種名・キャッチコピーは79件すべて一意。JoBinsのtitleは年齢表現を含むため流用せず、
職種分類・必須資格・勤務拠点・労働条件から書き下ろしている（下の META）。
"""
import csv
import glob
import json
import os
import re
import unicodedata

HERE = os.path.dirname(__file__)
HEADER_SRC = os.path.join(HERE, "..", "求人入力シート_v14_全20求人.csv")
DELIV = os.path.join(HERE, "..", "..", "deliverables", "2026-09-28_ジョビンズ")
RAW_DIR = os.path.join(DELIV, "raw")
OUT_CSV = os.path.join(DELIV, "求人入力シート_ジョビンズ_20260928.csv")
REPORT = os.path.join(DELIV, "_build_report.json")

MONEY = re.compile(r"(月給|年収|時給|日給|年俸)|[0-9][0-9,\.]*\s*(万円|円)")
# 本文欄では「145万」「約3.5億」のように円を伴わない金額表記も落とす
BODY_MONEY = re.compile(
    r"(月給|年収|時給|日給|年俸|賞与約)|[0-9][0-9,\.]*\s*(万円|円|万|億)"
)
TITLE_BANNED = ("OK", "ＯＫ", "歓迎")

# ---------------------------------------------------------------- 本文クリーニング
AGE_GENDER = re.compile(
    r"年齢|[0-9０-９]+\s*歳|若手|中堅|ベテラン|シニア|中高年|"
    r"[０-９0-9]+代|男性|女性|主婦|主夫|ママ|パパ|子育て|大学生|"
    r"第二新卒|既卒|新卒|国籍|外国籍|日本人|性別"
)
JP_LANG = re.compile(r"日本語能力試験|JLPT")
N_LEVEL = re.compile(r"N\s*([12345])")
AGENT = re.compile(r"貴社|ご紹介ください|人材紹介会社|エージェント|手数料|紹介フィー|推薦|面接確約")
INTERNAL = re.compile(r"転職回数|離職率|採用単価")
BOILER = re.compile(
    r"^[\s■・┗]*(経験不問|経験者歓迎|未経験者?歓迎|無資格歓迎|"
    r"ブランク(?:歓迎|OK)|扶養内勤務歓迎|学歴不問|資格不問)(?:[、，]\s*)?"
    r"(?:経験不問|経験者歓迎|未経験者?歓迎|無資格歓迎|ブランク(?:歓迎|OK))?\s*$"
)
DECOR = re.compile(r"^[\s\-=＝─━*＊+＋°˖✧◝◜|｜~〜_]+$")
EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF☀-➿️⬀-⯿〰〽]"
)


def clean_lines(text, drop_money=True):
    """行単位で掲載不可の内容を除去する。日本語力の要件は国籍条件から切り離して残す。"""
    if not text:
        return ""
    out = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.replace("　", " ").rstrip()
        bare = line.strip()
        if not bare:
            out.append("")
            continue
        if DECOR.match(bare):
            continue
        if JP_LANG.search(bare):
            m = N_LEVEL.search(unicodedata.normalize("NFKC", bare))
            lv = m.group(1) if m else "2"
            out.append(f"・日本語能力試験N{lv}相当以上の日本語力をお持ちの方（業務上必要なため）")
            continue
        if AGENT.search(bare) or INTERNAL.search(bare) or AGE_GENDER.search(bare):
            continue
        if drop_money and BODY_MONEY.search(unicodedata.normalize("NFKC", bare)):
            continue
        out.append(EMOJI.sub("", line).rstrip())
    txt = "\n".join(out)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    # 見出しだけが残った塊を落とす
    txt = re.sub(r"\n[【＜<].{0,30}[】＞>]\s*(?=\n\n|\Z)", "", txt)
    return txt.strip()


# 勤務地が定まらない表現（客先常駐・派遣先就業・配属先未定・全国配属・転勤あり等）。
# 依頼により原稿から一切出さない。まず句単位で削り、残る定型行は行ごと落とす。
VAGUE_SUB = [
    (r"お客さま先に常駐し、", ""),
    (r"後工程の顧客先の担当者", "後工程の担当者"),
    (r"客先常駐が中心の業務となります。\n?", ""),
    (r"お客様先にてコンサルタント業務をメインに担当いただきます",
     "コンサルタント業務をメインに担当いただきます"),
    (r"ご経験・希望に合わせて大手メーカーを中心とした取引先にて",
     "ご経験・希望に合わせて"),
    (r"（一部客先勤務の場合は応相談）", ""),
    (r"■全国に展開するガリバー店舗にて、", "■ガリバー店舗にて、"),
    (r"■社宅、独身寮完備（全国転勤型の場合、入居可及び一部自己負担あり）",
     "■社宅・独身寮完備"),
    (r"赴任手当、転勤赴任一時金、帰省旅費補助、引越費用補助",
     "帰省旅費補助、引越費用補助"),
    (r"【勤務地候補】[^\n]*\n?", ""),
    (r"[■※]?\s*初回配属時[^\n]*\n?", ""),
    (r"希望勤務地エリア[^\n]*\n?", ""),
    (r"[※■]?\s*(?:従事すべき業務の)?変更の範囲[：:][^\n]*\n?", ""),
    (r"（変更の範囲）[^\n]*\n?", ""),
    (r"※配属先によって手当が異なります\n?", ""),
    (r"転勤赴任一時金\n?", ""),
]
VAGUE_LINE = re.compile(
    r"客先常駐|常駐勤務|への常駐|に常駐"
    r"|顧客先|お客様先|お客さま先|取引先構内|構内請負|クライアント企業での勤務|派遣先企業"
    r"|全国の(?:各)?(?:オフィス|事業所|拠点)|全国47都道府県|全国オファー|全国配属|全国で勤務"
    r"|エリア社員制度|エリア限定社員|都道府県限定社員"
    r"|いずれかに配属|いずれかでの勤務|いずれかの店舗|いずれかの?拠点"
    r"|初期配属|配属先(?:が)?決定|配属割合|配属店舗|勤務地配慮|希望勤務地"
    r"|就業場所の変更|就業条件明示|変更の範囲"
    r"|転勤あり|転勤：あり|転勤の有無|転勤の可能性|転勤の難しい|全国転勤"
    r"|勤務地が変更|配置転換|長期の出張の可能性|就業形態"
)


def strip_vague_location(txt):
    """勤務地が定まらない表現を除去する。"""
    if not txt:
        return txt
    for pat, rep in VAGUE_SUB:
        txt = re.sub(pat, rep, txt)
    kept = [l for l in txt.split("\n") if not VAGUE_LINE.search(l)]
    txt = "\n".join(kept)
    return re.sub(r"\n{3,}", "\n\n", txt).strip()


def strip_lead_heading(txt):
    """API側が付けている先頭の【見出し】行を落とす（自前の見出しと重複するため）。"""
    if not txt:
        return txt
    return re.sub(r"^【[^】\n]{1,24}】\s*\n", "", txt.lstrip(), count=1).strip()


def bullets(text):
    """・/■ 混在の箇条書きを ■ に寄せ、項目間の空行を除く。"""
    if not text:
        return ""
    lines = []
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            lines.append("")
            continue
        s = re.sub(r"^[・◆★☆●○◎\-]\s*", "■", s)
        s = re.sub(r"^[■]{2,}", "■", s)
        s = re.sub(r"[：:]\s*補足事項なし\s*$", "", s)
        s = re.sub(r"^■(.{1,20})[：:]$", r"【\1】", s)
        lines.append(s)
    txt = "\n".join(lines)
    # ■ の項目間の空行を詰める
    while re.search(r"(■[^\n]*)\n\n(■)", txt):
        txt = re.sub(r"(■[^\n]*)\n\n(■)", r"\1\n\2", txt)
    return re.sub(r"\n{3,}", "\n\n", txt).strip()


# ---------------------------------------------------------------- 勤務地
# key: (郵便番号, 都道府県・市区町村・町域, 丁目・番地・号, 建物名, 勤務地の補足の追記, アクセス)
# 勤務地。客先常駐・配属先未定といった「勤務地が定まらない」表現を原稿に載せないため、
# raw JSON の勤務地詳細で確認できた実在の拠点住所だけを使って書き下ろしている。
# key: (郵便番号, 都道府県・市区町村・町域, 丁目・番地・号, 建物名, 勤務地の補足, アクセス)
LOC = {
    "toyohashi_engei_honsha": ("", "愛知県 豊橋市 神野新田町", "水神下64", "",
        "＜本社＞\n愛知県豊橋市神野新田町水神下64\n\n■通勤\nマイカー通勤が可能です。\n\n■受動喫煙対策\n屋内全面禁煙",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します（上限あり）。"),
    "toyohashi_engei_anjo": ("", "愛知県 安城市 石井町", "石原113", "",
        "＜安城事務所＞\n愛知県安城市石井町石原113\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します（上限あり）。"),
    "kajikawa": ("", "愛知県 碧南市 尾城町", "2丁目51番地", "",
        "＜本社＞\n愛知県碧南市尾城町2丁目51番地\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "maruyo": ("", "愛知県 西尾市 法光寺町", "西田23", "",
        "＜本社＞\n愛知県西尾市法光寺町西田23\n\n■転勤・出張\nありません。現場への直行直帰が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "matsui": ("", "愛知県 新城市 城北", "1-1-5", "",
        "＜本社＞\n愛知県新城市城北1-1-5\n\n■通勤\nマイカー通勤が可能です。現場への直行直帰が可能です。",
        "【アクセス】\nJR飯田線「新城駅」\n\n【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "marukoo": ("", "愛知県 豊田市 金谷町", "7-5", "",
        "＜本社＞\n愛知県豊田市金谷町7-5\n\n■通勤\nマイカー通勤が可能です。",
        "【アクセス】\n名鉄三河線「上挙母駅」徒歩8分\n愛知環状鉄道「新上挙母駅」徒歩6分\n\n【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "fd": ("", "愛知県 刈谷市 今川町", "花池3-1", "",
        "＜本社＞\n愛知県刈谷市今川町花池3-1",
        "【アクセス】\n名鉄名古屋本線「富士松駅」\n\n【交通費】\n通勤手当を支給します。"),
    "daichi": ("440-0026", "愛知県 豊橋市 多米西町", "一丁目5番地5", "",
        "＜本社＞\n愛知県豊橋市多米西町一丁目5番地5",
        "【アクセス】\n豊橋鉄道市内線「赤岩口駅」より徒歩\n\n【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "aichibase": ("", "愛知県 岡崎市 藤川町", "字北荒古15-1", "",
        "＜本社＞\n愛知県岡崎市藤川町字北荒古15-1\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "nid": ("", "愛知県", "", "",
        "勤務地は中部事業所（愛知県）です。\n\n■リモート勤務\n可能です。",
        "【交通費】\n通勤手当を支給します。"),
    "engineous_hashime": ("", "愛知県 岡崎市 橋目町", "", "",
        "＜本社＞\n愛知県岡崎市橋目町\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "engineous_okazaki": ("", "愛知県 岡崎市", "", "",
        "勤務地は愛知県岡崎市です。\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "baden": ("", "愛知県 安城市 尾崎町", "上大縄1", "ジェームス安城店",
        "＜ジェームス安城店＞\n愛知県安城市尾崎町上大縄1",
        "【交通費】\n通勤手当を支給します。"),
    "gonda": ("", "愛知県 新城市 庭野", "字東植田38-1", "",
        "＜本社＞\n愛知県新城市庭野字東植田38-1\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "enechita": ("475-0903", "愛知県 半田市", "", "エネチタ半田常滑ショールーム",
        "＜エネチタ半田常滑ショールーム＞\n愛知県半田市\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "technopro_it": ("", "東京都 千代田区 神田須田町", "1-10-2", "メットライフ神田須田町ビル7F",
        "＜本社＞\n東京都千代田区神田須田町1-10-2 メットライフ神田須田町ビル7F",
        "【交通費】\n通勤手当を支給します。"),
    "technopro_design": ("", "愛知県", "", "",
        "勤務地は愛知県です。",
        "【交通費】\n通勤手当を支給します。"),
    "technopro_kariya": ("", "愛知県 刈谷市 南桜町", "1", "刈谷事業所（当社開発センター）",
        "＜刈谷事業所（当社開発センター）＞\n愛知県刈谷市南桜町1\n\n■受動喫煙対策\n原則屋内禁煙",
        "【交通費】\n通勤手当を支給します。"),
    "hitachi_toyota": ("", "愛知県 豊田市", "", "",
        "勤務地は愛知県豊田市です。",
        "【交通費】\n通勤手当を支給します。"),
    "accessnet": ("", "愛知県 豊川市 穂ノ原", "", "",
        "＜本社＞\n愛知県豊川市穂ノ原\n\n■在宅勤務\n併用が可能です。\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "vnext_kariya": ("", "愛知県 刈谷市", "", "",
        "＜刈谷本社＞\n愛知県刈谷市\n\n■リモート勤務\n可能です。",
        "【交通費】\n通勤手当を支給します。"),
    "suzukane": ("", "愛知県 豊田市 中金町", "塚ノ本111-3", "",
        "＜本社＞\n愛知県豊田市中金町塚ノ本111-3\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "grop": ("", "愛知県", "", "",
        "勤務地は愛知県です。",
        "【交通費】\n通勤手当を支給します。"),
    "rix": ("", "愛知県 豊田市 寿町", "5-12", "中部テクニカルセンター",
        "＜中部テクニカルセンター＞\n愛知県豊田市寿町5-12",
        "【交通費】\n通勤手当を支給します。"),
    "suzuyo": ("", "愛知県 豊橋市", "", "豊橋支店",
        "＜豊橋支店＞\n愛知県豊橋市\n\n■転勤\nありません。",
        "【交通費】\n通勤手当を支給します。"),
    "cybercom": ("", "愛知県 刈谷市", "", "",
        "勤務地は愛知県刈谷市です。\n\n■リモート勤務\n相談可能です。",
        "【交通費】\n通勤手当を支給します。"),
    "idom": ("", "愛知県", "", "",
        "勤務地は愛知県内の直営店舗です。\n\n■受動喫煙対策\n屋内全面禁煙",
        "【交通費】\n通勤手当を支給します。"),
    "meitec": ("", "愛知県", "", "",
        "勤務地は愛知県です。\n\n■雇用形態\n無期雇用派遣（正社員）としての雇用です。",
        "【交通費】\n通勤手当を支給します。"),
    "taihei": ("", "愛知県 豊田市 田籾町", "", "豊田ODCセンター",
        "＜豊田ODCセンター＞\n愛知県豊田市田籾町\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
    "advantech": ("", "愛知県 安城市 横山町", "横山321", "",
        "＜本社＞\n愛知県安城市横山町横山321\n\n■通勤\nマイカー通勤が可能です。",
        "【通勤方法】\nマイカー通勤可\n\n【交通費】\n通勤手当を支給します。"),
}

# ---------------------------------------------------------------- 職種名・キャッチコピー
# id8: (職種名, キャッチコピー, 勤務地key, 職業カテゴリー)
CAT_KOJI_DOBOKU = "土木施工管理、工事監督/現場監督、建設・土木エンジニア"
CAT_KOJI_KENCHIKU = "建築施工管理、工事監督/現場監督、建設・土木エンジニア"
CAT_ZOEN = "造園/エクステリア施工、土木施工管理、工事監督/現場監督"
CAT_SETSUBI = "設備施工管理、電気工事施工管理、工事監督/現場監督"
CAT_CONSUL = "土木設計、測量/調査、建設コンサルタント"
CAT_KIKAI = "機械設計、CAD/CAEオペレーター、生産技術"
CAT_DENKI = "電気設計、回路設計、電子/半導体エンジニア"
CAT_SEISAN = "生産技術、生産設備設計、製造プロセス開発"
CAT_KUMIKOMI = "組み込みエンジニア、制御系ソフトウェア開発、システムエンジニア"
CAT_SE = "システムエンジニア、アプリケーションエンジニア、社内SE"
CAT_INFRA = "ネットワークエンジニア、サーバーエンジニア、インフラエンジニア"
CAT_EIGYO_HOJIN = "法人営業、個人営業、企画営業"
CAT_EIGYO_TENPO = "販売員/セールススタッフ、個人営業、カウンターセールス"
CAT_SEIBI = "自動車整備士、整備/メンテナンス、機械整備"
CAT_BUTSURYU = "物流/倉庫管理、生産管理/工程管理、法人営業"

META = {
    # 株式会社豊橋園芸ガーデン
    "19697330": ("土木施工管理（緑化工事／現場責任者候補）／豊橋本社",
        "【豊橋・転勤なし】緑化工事の土木施工管理を現場責任者候補として／施工計画の立案から現場のマネジメントまで。完全週休2日制・残業は月平均20時間以内",
        "toyohashi_engei_honsha", CAT_KOJI_DOBOKU),
    "2b46878c": ("土木施工管理（緑化工事／経験者）／豊橋本社",
        "【豊橋・転勤なし】造園・緑化の土木施工管理／年間700件の緑化実績がある会社です。完全週休2日制・マイカー通勤可",
        "toyohashi_engei_honsha", CAT_KOJI_DOBOKU),
    "3c43c8f6": ("土木施工管理（緑化工事／未経験から）／豊橋本社",
        "【豊橋・転勤なし】未経験から始める緑化工事の土木施工管理／資格取得支援あり。完全週休2日制・マイカー通勤可",
        "toyohashi_engei_honsha", CAT_KOJI_DOBOKU),
    "2e8a425e": ("造園施工管理（未経験から）／豊橋本社",
        "【豊橋・転勤なし】未経験から始める造園施工管理／オフィスビルや公共施設の緑化を手がけます。完全週休2日制",
        "toyohashi_engei_honsha", CAT_ZOEN),
    "a90fc1e8": ("造園施工管理（未経験から／植栽・樹木管理）／豊橋本社",
        "【豊橋】造園施工管理を未経験からスタート／植栽や樹木管理の技術を基礎から身につけられます。完全週休2日制・残業は月平均20時間以内",
        "toyohashi_engei_honsha", CAT_ZOEN),
    "49728768": ("土木施工管理（緑化工事／経験者）／安城事業所",
        "【安城・転勤なし】緑化事業の土木施工管理／公共施設や商業施設の現場を担当します。完全週休2日制・マイカー通勤可",
        "toyohashi_engei_anjo", CAT_KOJI_DOBOKU),
    "f69da7f2": ("土木施工管理（緑化工事／未経験から）／安城事業所",
        "【安城・転勤なし】未経験から土木施工管理へ／先輩と現場を回りながら覚えられます。完全週休2日制・マイカー通勤可",
        "toyohashi_engei_anjo", CAT_KOJI_DOBOKU),
    "b488c63c": ("造園施工管理（経験者）／安城事業所",
        "【安城・転勤なし】造園施工管理の経験者募集／テーマパークや商業施設の造園も手がけます。完全週休2日制",
        "toyohashi_engei_anjo", CAT_ZOEN),
    "d9adc174": ("造園施工管理（現場責任者候補）／安城事業所",
        "【安城・転勤なし】造園施工管理の現場責任者候補／施工計画の算段から現場全体のマネジメントまで任せます。完全週休2日制",
        "toyohashi_engei_anjo", CAT_ZOEN),
    "4c625a32": ("造園施工管理（未経験から）／安城事業所",
        "【安城・転勤なし】造園施工管理を未経験からスタート／年間700件の緑化実績。完全週休2日制・マイカー通勤可",
        "toyohashi_engei_anjo", CAT_ZOEN),
    # 株式会社梶川建設
    "259f8de0": ("建築施工管理（1級・2級建築施工管理技士）",
        "【碧南市】地域のインフラを支える建築施工管理／資格手当あり。建築のスペシャリストを目指せます",
        "kajikawa", CAT_KOJI_KENCHIKU),
    "d2bf36f6": ("土木現場スタッフ（未経験から）",
        "【碧南市】未経験から始める土木の現場作業／安定企業の正社員として現場技術を磨けます。福利厚生が充実",
        "kajikawa", CAT_KOJI_DOBOKU),
    # 丸洋建設株式会社
    "22c1bee2": ("建築施工管理（1級建築施工管理技士）",
        "【西尾市・転勤なし】地元密着の建築施工管理／直行直帰可・完全週休2日制・月曜と金曜はノー残業デー。健康経営優良法人に2年連続認定",
        "maruyo", CAT_KOJI_KENCHIKU),
    "b6606ebe": ("土木施工管理（1級土木施工管理技士）",
        "【西尾市・転勤なし】官公庁案件中心の土木施工管理／直行直帰可・完全週休2日制・月曜と金曜はノー残業デー",
        "maruyo", CAT_KOJI_DOBOKU),
    # 松井建拓株式会社
    "41f68fb0": ("建築施工管理（2級建築施工管理技士）",
        "【新城市】2級建築施工管理技士の募集／平均残業は月15時間程度。地元で腰を据えて働けます",
        "matsui", CAT_KOJI_KENCHIKU),
    "52609dba": ("土木施工管理（2級土木施工管理技士）",
        "【新城市】2級土木施工管理技士の募集／平均残業は月15時間程度。地元密着の現場です",
        "matsui", CAT_KOJI_DOBOKU),
    "e09ba532": ("建築施工管理（未経験から／資格取得支援）",
        "【新城市】未経験から建築施工管理へ／働きながら資格取得を支援します。直行直帰可・平均残業は月15時間程度",
        "matsui", CAT_KOJI_KENCHIKU),
    # 株式会社マルコオ・ポーロ化工
    "0c78c992": ("建築施工管理（改修工事／1級建築施工管理技士）",
        "【豊田市・名古屋市】改修工事のスペシャリスト集団で1級建築施工管理技士を募集／東証プライム上場グループ・年間休日126日へ拡大中",
        "marukoo", CAT_KOJI_KENCHIKU),
    "1e84ecbe": ("建築施工管理（改修工事／2級建築施工管理技士以上）",
        "【豊田市・名古屋市】2級建築施工管理技士以上の方を募集／東海トップクラスの改修実績。技術者が報われる環境です",
        "marukoo", CAT_KOJI_KENCHIKU),
    "162f36ee": ("建築施工管理（改修工事／2級取得者・実務経験者）",
        "【豊田市・名古屋市】数億円規模の改修案件で経験を積める建築施工管理／東証プライム上場グループ・年間休日126日へ拡大中",
        "marukoo", CAT_KOJI_KENCHIKU),
    "ada69f60": ("建築施工管理（改修工事／資格不問・実務経験3年目安）",
        "【豊田市・名古屋市】資格は問わない建築施工管理／高単価の改修案件を手がける上場グループ。年間休日126日へ拡大中",
        "marukoo", CAT_KOJI_KENCHIKU),
    # 株式会社FD
    "076b353c": ("太陽光設備の施工管理（課長クラス／実務5年以上・有資格者）",
        "【刈谷市】太陽光発電の施工プロデューサー（課長クラス）／電気設備の施工管理経験5年以上の方を募集。完全週休2日制",
        "fd", CAT_SETSUBI),
    "942027ea": ("太陽光設備の施工管理（課長クラス／資格不問）",
        "【刈谷市】成長市場の太陽光発電で施工プロデューサー（課長クラス）／完全週休2日制・賞与3.5ヶ月分",
        "fd", CAT_SETSUBI),
    "c713799a": ("施工統括（部長候補／太陽光設備）",
        "【刈谷市】日本初・特許取得の工法を扱う施工統括の部長候補／完全週休2日制・賞与3.5ヶ月分",
        "fd", CAT_SETSUBI),
    "20b4fbd3": ("法人営業（太陽光発電）",
        "【刈谷市】太陽光発電のSDGs戦略パートナーとして法人営業／完全週休2日制",
        "fd", CAT_EIGYO_HOJIN),
    # 株式会社大地コンサルタント
    "8d53f5d4": ("土木測量設計（技術士／設計マネジメント）",
        "【豊橋市】技術士として上流から下流まで一貫して担う土木測量設計／測量から設計まで自社完結・土日祝休み",
        "daichi", CAT_CONSUL),
    "d890374e": ("土木測量設計（技術士／監理・照査・後進育成）",
        "【豊橋市】技術士として監理・照査と技術の継承を担う／現場調整ではなく設計品質を支える役割です。土日祝休み",
        "daichi", CAT_CONSUL),
    "4db6e5c8": ("土木測量設計（RCCM／管理技術者）",
        "【豊橋市】RCCM保有者を管理技術者として募集／測量データから自社で取得。土日祝休み・資格取得支援あり",
        "daichi", CAT_CONSUL),
    "6dbee28a": ("土木測量設計（RCCM／ICT測量・3D設計）",
        "【豊橋市】RCCM保有者の募集／ドローン測量から3D設計データ作成まで内製化した職場です。土日祝休み",
        "daichi", CAT_CONSUL),
    "b3558b20": ("土木測量設計（未経験から／資格取得支援）",
        "【豊橋市】未経験から土木測量設計のプロへ／最新ドローンと3D解析を扱える環境。土日祝休み・資格取得支援あり",
        "daichi", CAT_CONSUL),
    "f60f14f6": ("土木測量設計（資格不問／設計経験1年以上）",
        "【豊橋市】資格は問いません。土木設計の経験1年以上で応募できます／自社完結のワンストップ体制。土日祝休み",
        "daichi", CAT_CONSUL),
    # 愛知ベース工業株式会社
    "54085312": ("土木施工管理（地盤改良工事／2級土木施工管理技士）",
        "【岡崎市】地盤改良工事の土木施工管理／不動テトラグループの安定基盤。年間休日125日・完全週休2日制（土日祝）",
        "aichibase", CAT_KOJI_DOBOKU),
    "253fc2aa": ("土木施工管理（地盤改良工事／資格不問・建設業経験2年目安）",
        "【岡崎市】資格は問わない地盤改良工事の施工管理／培った経験を地元で活かせます。年間休日125日・完全週休2日制（土日祝）",
        "aichibase", CAT_KOJI_DOBOKU),
    "41df76c0": ("設計（地盤改良工事／未経験から）",
        "【岡崎市】地盤改良工事の設計を未経験からスタート／理系四大卒の方を対象にした募集です。年間休日125日・完全週休2日制（土日祝）",
        "aichibase", CAT_CONSUL),
    # 株式会社エヌアイデイ
    "77d7cecc": ("組み込みエンジニア（車載開発／PM・リーダー）",
        "【愛知】大手自動車メーカーの車載開発でPM・リーダーを担う／フレックス・年間休日124日・リモート勤務可",
        "nid", CAT_KUMIKOMI),
    "ba99e898": ("組み込みエンジニア（車載開発／ソフトウェア設計）",
        "【愛知】上場企業で大手自動車メーカーの車載開発に携わる組み込みエンジニア／リモート勤務可・フレックス",
        "nid", CAT_KUMIKOMI),
    "ff4748cb": ("組み込みエンジニア（車載システム開発／プログラマ）",
        "【愛知】車載システム開発の上流工程に携われる組み込みエンジニア／リモート勤務可・フレックス",
        "nid", CAT_KUMIKOMI),
    # 株式会社エンジニアス
    "84a9e502": ("制御設計（自動車電子設計／車載HMI）",
        "【岡崎市】自動車の電子設計・制御設計／メーターなどの車載HMI部品の設計に携われます",
        "engineous_hashime", CAT_DENKI),
    "8400d7dc": ("自動車整備（試作車・試験車）",
        "【岡崎市】大手自動車メーカーの試作車・試験車を整備する仕事／自動車整備士資格と実務経験を活かせます",
        "engineous_hashime", CAT_SEIBI),
    "165287dc": ("生産技術（組立ライン設備の導入）",
        "【岡崎市】組立ライン設備の導入を担う生産技術／会社説明を兼ねたカジュアル選考から始められます",
        "engineous_okazaki", CAT_SEISAN),
    "65fafaba": ("生産技術（塗装設備）",
        "【岡崎市】塗装分野の生産技術／塗料メーカーでの就業経験を活かせます。会社説明を兼ねたカジュアル選考",
        "engineous_okazaki", CAT_SEISAN),
    "7c4b8eae": ("生産技術（溶接設備の導入）",
        "【岡崎市】溶接設備導入を担う生産技術／会社説明を兼ねたカジュアル選考から始められます",
        "engineous_okazaki", CAT_SEISAN),
    "995949c4": ("生産技術（樹脂成形）",
        "【岡崎市】樹脂分野の生産技術／生産技術の実務経験を活かせます。会社説明を兼ねたカジュアル選考",
        "engineous_okazaki", CAT_SEISAN),
    # 株式会社バーデン
    "afbf263b": ("自動車整備士（2級以上）",
        "【安城市】カー用品店併設ピットの自動車整備士／2級整備士資格をお持ちの方を募集。キャリアアップできる環境です",
        "baden", CAT_SEIBI),
    "f6d5c869": ("自動車検査員",
        "【安城市】自動車検査員資格を活かせるお仕事／カー用品店併設ピットでの点検・検査業務です",
        "baden", CAT_SEIBI),
    # 株式会社ごんだ
    "b12482da": ("土木施工管理（2級・1級土木施工管理技士）",
        "【新城市】公共工事比率95％の安定基盤で土木施工管理／有資格者の募集。年間休日123日・賞与4ヶ月分",
        "gonda", CAT_KOJI_DOBOKU),
    "a424d8d0": ("土木施工管理（未経験・資格不問）",
        "【新城市】未経験・無資格から始める土木施工管理／設立昭和41年の地域密着企業。年間休日123日・賞与4ヶ月分",
        "gonda", CAT_KOJI_DOBOKU),
    # 株式会社エネチタ
    "74d352d4": ("反響営業（リフォーム／未経験から）",
        "【半田市】100％反響営業のリフォーム提案／地域密着企業で未経験から始められます。年間休日135日・賞与年3回",
        "enechita", CAT_EIGYO_TENPO),
    # テクノプロ
    "7b54f896": ("インフラエンジニア（ネットワーク設計・構築／実務10年以上）",
        "【東京・神田】設計・構築から運用まで一貫して担うインフラエンジニア／実務10年以上の方を募集",
        "technopro_it", CAT_INFRA),
    "106b7cf8": ("機械設計（航空機シート／ポテンシャル採用）",
        "【愛知】航空機シートの機械設計エンジニア／社会人経験1年以上から応募できるポテンシャル採用。WEB面接可",
        "technopro_design", CAT_KIKAI),
    "10a0e83e": ("アナログ回路設計（次世代モビリティ）",
        "【刈谷市・自社開発センター勤務】次世代モビリティの回路エンジニア／アナログ電子回路の知見を活かせます",
        "technopro_kariya", CAT_DENKI),
    "530c788c": ("サーバーエンジニア（クラウド・オンプレミス基盤）",
        "【東海】AWS・GCP・Azureやオンプレミス環境のインフラ基盤の設計・構築・運用／リモート勤務可",
        "technopro_design", CAT_INFRA),
    "530d820e": ("ソフトウェアエンジニア（業務系・Web・AI・画像処理）",
        "【東海】業務系システムからクラウドサービス、Webアプリ、AI、画像処理まで幅広く手がけるソフトウェア開発／リモート勤務可",
        "technopro_design", CAT_SE),
    "532af4d8": ("組み込みエンジニア（車載ECU・ロボット・建設機械）",
        "【東海】車載ECU、自走式ロボット、アームロボット、建設機械、医療装置の組み込み開発／実務5年以上の方を募集",
        "technopro_design", CAT_KUMIKOMI),
    "58380d30": ("開発エンジニア（エアモビリティ）",
        "【東海】エアモビリティなど次世代モビリティの開発エンジニア／制御ソフトの知見を活かせます",
        "technopro_design", CAT_KUMIKOMI),
    # 株式会社日立産業制御ソリューションズ
    "2982044e": ("システムエンジニア（車載自己診断機能／フレックス勤務）",
        "【豊田市】自動車メーカー向け車載システムの自己診断機能の設計開発／フレックス勤務。英語に抵抗のない方を歓迎します",
        "hitachi_toyota", CAT_KUMIKOMI),
    "4ac27c2e": ("システムエンジニア（車載診断／残業月20時間程度）",
        "【豊田市】車載診断の知見を活かせるシステムエンジニア／残業は平均20時間程度でワークライフバランスを保てます",
        "hitachi_toyota", CAT_SE),
    # 株式会社アクセスネット
    "b66c8920": ("社内システム開発（生産管理システム／上流工程）",
        "【豊川市】コンサルから上流工程全般とベンダーコントロール／在宅勤務併用可・平均残業は月15時間程度",
        "accessnet", CAT_SE),
    # 株式会社ビーネックスソリューションズ
    "5e52f244": ("組み込みソフトウェア開発（C++・Linux）",
        "【刈谷市】組み込みソフトウェア開発のメンバー募集／C++とLinuxの経験を活かせます。リモート勤務あり",
        "vnext_kariya", CAT_KUMIKOMI),
    "7b9a3808": ("車載制御ソフトウェア開発（受託持ち帰り業務）",
        "【刈谷市】車載制御ソフトウェアの受託開発／自動車の業務知識は問いません。リモート勤務あり",
        "vnext_kariya", CAT_KUMIKOMI),
    "7de0f5ac": ("組み込みソフトウェア開発（本社勤務・リモート併用）",
        "【刈谷市】刈谷本社勤務の組み込みソフトウェア開発／リモートと出社の割合は1対1です",
        "vnext_kariya", CAT_KUMIKOMI),
    # 株式会社鈴鍵
    "a46b14fc": ("造園・土木施工管理（ビオトープ施工）",
        "【豊田市】全国トップクラスのビオトープ施工に携わる造園・土木施工管理／設立45年の安定企業。引越し費用の一部負担あり",
        "suzukane", CAT_ZOEN),
    "1baa5a86": ("造園・土木施工管理（公園・緑地／資格不問）",
        "【豊田市】公園・緑地づくりを支える造園・土木施工管理／資格は問いません。全国からの応募可・引越し費用の一部負担あり",
        "suzukane", CAT_ZOEN),
    # 株式会社グロップ
    "fdc6f8e2": ("提案営業・キャリアアドバイザー",
        "【東海】提案営業またはキャリアアドバイザー／選考を通じて適したポジションを決定します",
        "grop", CAT_EIGYO_HOJIN),
    # リックス株式会社
    "77029290": ("機械設計（3D CAD／実務5年程度）",
        "【豊田市】中部テクニカルセンターでの機械設計／3D CADを使った設計業務のご経験を活かせます",
        "rix", CAT_KIKAI),
    # 鈴与株式会社
    "f6ba0e56": ("ソリューション営業（物流）",
        "【豊橋市・転勤なし】物流のソリューション営業／社会人経験1年以上から応募できます",
        "suzuyo", CAT_EIGYO_HOJIN),
    "f717dc70": ("ポートロジスティクス（港湾物流のオペレーション構築・推進）",
        "【豊橋市・転勤なし】港湾物流のオペレーション構築・推進／社会人経験1年以上から応募できます",
        "suzuyo", CAT_BUTSURYU),
    # サイバーコム株式会社
    "14d69ed8": ("制御ソフトウェア開発エンジニア（C／C++）",
        "【名古屋・刈谷】制御ソフトウェア開発エンジニア／残業は月20時間程度・リモート相談可・賞与4.7か月分",
        "cybercom", CAT_KUMIKOMI),
    # 株式会社IDOM
    "6869eaf4": ("スマートカーライフプランナー（営業・接客販売の経験者）",
        "【愛知県】中古車販売のスマートカーライフプランナー／営業または接客販売の経験1年以上の方を募集",
        "idom", CAT_EIGYO_TENPO),
    "6a3e1788": ("スマートカーライフプランナー（業界未経験から）",
        "【愛知県】Gulliverのスマートカーライフプランナー／車業界が未経験の方も応募できます",
        "idom", CAT_EIGYO_TENPO),
    # 株式会社メイテックフィルダーズ
    "45a5687c": ("ITエンジニア（Java・Python・PHP／無期雇用派遣）",
        "【愛知県】車・医療機器・ロボットなどのITエンジニア／無期雇用派遣（正社員）としての雇用です",
        "meitec", CAT_SE),
    "4641313a": ("組み込み・制御エンジニア（無期雇用派遣）",
        "【愛知県】自動車・医療機器・航空関連の組み込み・制御エンジニア／無期雇用派遣（正社員）としての雇用です",
        "meitec", CAT_KUMIKOMI),
    "46d6a242": ("電気設計エンジニア（実務経験者／無期雇用派遣）",
        "【愛知県】自動車・医療機器・航空関連の電気設計エンジニア／電気分野の実務経験1年以上の方を募集",
        "meitec", CAT_DENKI),
    "470a9af2": ("電気設計エンジニア（実務未経験／履修経験者）",
        "【愛知県】電子回路・電気回路の履修経験があれば実務未経験でも応募できる電気設計エンジニア／無期雇用派遣（正社員）",
        "meitec", CAT_DENKI),
    "470d549a": ("機械設計エンジニア（実務未経験／履修経験者）",
        "【愛知県】力学・製図・CADの履修経験があれば実務未経験でも応募できる機械設計エンジニア／無期雇用派遣（正社員）",
        "meitec", CAT_KIKAI),
    "4730daf0": ("フィールドエンジニア（医療機器・昇降機・半導体製造装置）",
        "【愛知県】医療機器や昇降機、半導体製造装置のフィールドエンジニア／無期雇用派遣（正社員）としての雇用です",
        "meitec", CAT_SEIBI),
    # 太平産業株式会社
    "ebc287ad": ("重機整備士（学歴・英語力不問）",
        "【豊田市】現場の安全を守る重機整備士／学歴と英語力は問いません。12月中のスタートも相談できます",
        "taihei", CAT_SEIBI),
    # 株式会社アドバン・テック
    "b4adce48": ("機械設計（実務未経験から）",
        "【安城市】実務未経験から始める機械設計／普通自動車運転免許があれば応募できます",
        "advantech", CAT_KIKAI),
    "bdf4edfa": ("電気設計（実務未経験から）",
        "【安城市】実務未経験から始める電気設計／普通自動車運転免許があれば応募できます",
        "advantech", CAT_DENKI),
}

# 低給与マークのしきい値
LOW_MONTH = 250000
LOW_YEAR = 3500000

FIXED_OT = re.compile(
    r"固定残業手当/月：([0-9,]+)円(?:～([0-9,]+)円)?（固定残業時間(\d+)時間(\d+)分"
)
SCHED_HOURS = re.compile(r"総所定労働時間：(\d+)時間")
ANNUAL_HOLIDAY = re.compile(r"年間休日[^0-9\n]{0,8}([0-9]{2,3})\s*日")
DAY_SPAN = re.compile(r"([0-9]{1,2}):([0-9]{2})\s*[~～\-−]\s*([0-9]{1,2}):([0-9]{2})")
BREAK_MIN = re.compile(r"休憩(?:時間)?[：:]?\s*([0-9]{1,3})\s*分")
DAILY_EXPLICIT = re.compile(
    r"(?:所定労働時間|実労働時間|実労働|実働時間|実働)[：:]?\s*(?:1日あたり)?\s*"
    r"([0-9]{1,2})\s*時間(?:\s*([0-9]{1,2})\s*分)?"
)
STD_BAND = re.compile(r"標準的な勤務時間帯[^0-9]{0,8}"
                      r"([0-9]{1,2}):([0-9]{2})\s*[~～\-−]\s*([0-9]{1,2}):([0-9]{2})")


def compact_bullets(txt):
    """■/✔ の箇条書きが連続する箇所の空行を詰める（欄を組み立てた後の最終処理）。"""
    if not txt:
        return txt
    pat = re.compile(r"(^|\n)([■✔][^\n]*)\n\n+(?=[■✔])")
    while pat.search(txt):
        txt = pat.sub(r"\1\2\n", txt)
    return txt


def yen(man):
    return int(round(float(man) * 10000))


def build_row(payload, meta, header):
    d = payload["data"]
    det = d["details"]
    o = det["overview"]
    sal = o["salary"]
    name, copy, lockey, category = meta
    zipc, town, banchi, bldg, loc_extra, access = LOC[lockey]

    notes = []

    # --- 給与
    mi = sal["monthly_income"] or {}
    an = sal["annual_income"] or {}
    m_min, m_max = mi.get("min_month_salary"), mi.get("max_month_salary")
    y_min, y_max = an.get("min_year_salary"), an.get("max_year_salary")
    derived = False
    if m_min is None and y_min is not None:
        m_min = float(y_min) / 12.0
        m_max = float(y_max) / 12.0 if y_max is not None else None
        derived = True
        notes.append("月給は想定年収の1/12から算出")
    smin = yen(m_min) if m_min is not None else ""
    smax = yen(m_max) if m_max is not None else ""
    disp = "範囲で表示" if smax else "最低額を表示"

    # --- 固定残業代
    sd = sal.get("salary_detials") or ""
    fx = FIXED_OT.search(sd)
    if fx:
        f_min = int(fx.group(1).replace(",", ""))
        f_max = int((fx.group(2) or fx.group(1)).replace(",", ""))
        fixed = ("あり", str(f_min), str(f_max), "月", fx.group(3), fx.group(4), "同意する")
    else:
        fixed = ("なし", "", "", "", "", "", "")
        if "固定残業" in sd and "固定残業代：なし" not in sd:
            notes.append("固定残業代の内訳が定型でないため固定残業代欄は「なし」。賃金内訳は給与の補足に全文掲載")

    # --- 所定労働時間
    wh = o["employment_type"].get("working_hours") or ""
    m = SCHED_HOURS.search(wh)
    hd = o["holiday"].get("holiday_details") or ""
    if m:
        sched = m.group(1)
    else:
        m2 = ANNUAL_HOLIDAY.search(hd) or ANNUAL_HOLIDAY.search(wh)
        nwh = unicodedata.normalize("NFKC", wh)
        daily = None
        dex = DAILY_EXPLICIT.search(nwh)
        if dex:
            daily = int(dex.group(1)) + (int(dex.group(2)) / 60.0 if dex.group(2) else 0.0)
        else:
            span = STD_BAND.search(nwh) or DAY_SPAN.search(nwh)
            if span:
                g = span.groups()[-4:]
                start = int(g[0]) * 60 + int(g[1])
                end = int(g[2]) * 60 + int(g[3])
                if end <= start:
                    end += 24 * 60
                brk = BREAK_MIN.search(nwh)
                daily = (end - start - (int(brk.group(1)) if brk else 60)) / 60.0
        if daily is not None and not (5 <= daily <= 10):
            daily = None
        if m2 and daily:
            sched = str(int(round((365 - int(m2.group(1))) * daily / 12)))
            notes.append(
                f"平均所定労働時間は年間休日{m2.group(1)}日と1日{daily:g}時間から算出")
        elif m2:
            sched = str(int(round((365 - int(m2.group(1))) * 8 / 12)))
            notes.append(f"平均所定労働時間は年間休日{m2.group(1)}日と1日8時間から算出")
        else:
            sched = ""
            notes.append("平均所定労働時間の根拠となる値がAPIにないため空欄")

    # --- 試用期間
    et = o["employment_type"]
    if et.get("probation_period") == "Y":
        pp = ("あり", "", "", clean_lines(et.get("probation_period_detail")) or "")
        pd_txt = strip_lead_heading(clean_lines(et.get("probation_period_detail"))) or ""
        mm = re.search(r"(\d+)\s*(?:ヶ|ヵ|か|カ)月", unicodedata.normalize("NFKC", pd_txt))
        pp = ("あり", mm.group(1) if mm else "", "か月" if mm else "", pd_txt)
        if not mm:
            notes.append("試用期間の月数がAPIの記述から特定できないため期間欄は空欄")
    else:
        pp = ("なし", "", "", "")

    # --- 本文
    duty = bullets(clean_lines(o.get("job_description")))
    dd = clean_lines(o.get("job_description_detail"))
    if dd:
        duty = duty + "\n\n" + bullets(dd)

    req = strip_lead_heading(clean_lines(det["application_requirements"].get("application_requirement_detail")))
    wel = strip_lead_heading(clean_lines(det["application_requirements"].get("welcome_condition")))
    wel = "\n".join(l for l in wel.split("\n") if not BOILER.match(l))
    person = ""
    if req:
        person += "【必須条件】\n" + bullets(req)
    if wel:
        person += ("\n\n" if person else "") + "【歓迎条件】\n" + bullets(wel)
    edu = det["tags"].get("minimum_education_level")
    if edu:
        person += ("\n\n" if person else "") + "【学歴】\n" + edu
    if not person.strip():
        person = "【必須条件】\n詳細はお問い合わせください。"
        notes.append("応募条件がすべて年齢・国籍等の記述だったため必須条件欄を仮置き（要確認）")

    chars = [c["title"] for c in det["tags"].get("characteristics") or []]
    chars = [c for c in chars
             if not AGE_GENDER.search(c) and not MONEY.search(c)
             and not AGENT.search(c) and not INTERNAL.search(c)]
    appeal_items = []
    for c in chars:
        appeal_items.append("■" + c)
    ot = et.get("average_monthly", {}).get("overtime_hours_details")
    if ot and not MONEY.search(ot):
        appeal_items.append(f"■月平均残業時間 {ot}")
    emp = det.get("number_of_employees")
    estd = det.get("estd_date")
    ipo = det.get("ipo")
    if estd:
        appeal_items.append(f"■設立 {estd}")
    if emp:
        appeal_items.append(f"■従業員数 {emp}名")
    if ipo and "未上場" not in ipo:
        appeal_items.append(f"■{ipo}")
    appeal = "\n".join(appeal_items)

    hours_txt = clean_lines(wh)
    if ot:
        hours_txt += f"\n\n■月平均残業時間\n{ot}"
    holiday_txt = ""
    if o["holiday"].get("holiday"):
        holiday_txt += "■" + o["holiday"]["holiday"] + "\n"
    holiday_txt += bullets(clean_lines(o["holiday"].get("holiday_details")))

    # 勤務地の補足は LOC の確定文のみ。APIの work_location_detail は
    # 客先常駐・配属先未定の記述を含むため本文には使わない（出典は raw JSON に保存済み）。
    loc_txt = loc_extra

    # 給与の補足（金額を載せてよい唯一の本文欄）
    pay = "【給与】\n"
    pay += f"月給 {yen(m_min):,}円" + (f"〜{yen(m_max):,}円" if m_max else "〜") + "\n"
    if derived:
        pay += "※想定年収をもとにした月額換算です。\n"
    if y_min:
        pay += f"\n【想定年収】\n{int(y_min)}万円" + (f"〜{int(y_max)}万円" if y_max else "〜") + "\n"
    if sd:
        pay += "\n【賃金内訳・給与の補足】\n" + clean_lines(sd, drop_money=False)
    bd = o["benefits_and_welfare"].get("bonus_details")
    if bd:
        pay += "\n\n【賞与】\n" + strip_lead_heading(clean_lines(bd, drop_money=False))
    va = o["benefits_and_welfare"].get("various_allowances")
    if va:
        pay += "\n\n【各種手当】\n" + bullets(strip_lead_heading(clean_lines(va, drop_money=False)))

    benefit = ""
    wbd = clean_lines(o["benefits_and_welfare"].get("welfare_benefits_detail"))
    wb = o["benefits_and_welfare"].get("welfare_benefits") or []
    wb = [w for w in wb if not AGE_GENDER.search(w) and not MONEY.search(w)]
    if wb:
        benefit += "【福利厚生】\n" + "\n".join("■" + w for w in wb) + "\n\n"
    if wbd:
        benefit += bullets(wbd)
    # 手当は名称のみ（金額は給与の補足へ）
    if va:
        names = [re.sub(r"[：:].*$", "", l.strip().lstrip("■・")) for l in va.split("\n") if l.strip()]
        names = [n for n in names if n and not MONEY.search(n) and not AGE_GENDER.search(n)]
        if names:
            benefit += "\n\n【手当】\n" + "\n".join("■" + n for n in dict.fromkeys(names))
    benefit = benefit.strip() or "社会保険完備"

    other = ""
    reason = clean_lines(o.get("reason_for_recruitment"))
    if reason:
        other += "【募集背景】\n" + reason + "\n\n"
    other += "【雇用形態】\n" + (et.get("employment_type") or "正社員") + "\n\n"
    flow = strip_lead_heading(clean_lines(o.get("selection_flow") or det.get("selection_flow")))
    if flow:
        other += "【選考フロー】\n" + flow + "\n\n"
    smoke = strip_lead_heading(clean_lines(o["secondhand_smoke"].get("details_on_secondhand")))
    if smoke:
        other += "【就業場所における受動喫煙防止措置】\n" + smoke
    else:
        notes.append("受動喫煙対策の記載がAPIにないため空欄")
    other = other.strip()

    hires = (o.get("number_of_hires") or det.get("number_of_hires") or "1")
    hires = re.sub(r"[^0-9]", "", str(hires)) or "1"

    tag_list = ["交通費支給", "社会保険完備"]
    if "転勤なし" in copy or "転勤はありません" in loc_txt:
        tag_list.append("転勤なし")
    if edu == "学歴不問":
        tag_list.append("学歴不問")
    if "マイカー通勤" in access:
        tag_list.append("マイカー通勤OK")
    if o["holiday"].get("holiday") == "土日休み":
        tag_list.append("土日祝休み")
    if o["benefits_and_welfare"].get("bonuses") == "Y":
        tag_list.append("賞与あり")
    if "リモート" in (loc_txt + copy + hours_txt):
        tag_list.append("リモートワーク可")
    if "未経験" in (req + name):
        tag_list.append("未経験歓迎")
    tags = "、".join(dict.fromkeys(tag_list))

    row = {
        "ステータス": "募集中",
        "会社名": d["company_name"],
        "職種名": f"{name}｜{d['company_name']}",
        "職業カテゴリー": category,
        "求人キャッチコピー": copy,
        "勤務地（郵便番号）": zipc,
        "勤務地（都道府県・市区町村・町域）": town,
        "勤務地（丁目・番地・号）": banchi,
        "勤務地（建物名・階数）": bldg,
        "雇用形態": "正社員",
        "有料職業紹介に該当": "はい",
        "給与形態": "月給",
        "給与（最低額）": str(smin),
        "給与（最高額）": str(smax),
        "給与（表示形式）": disp,
        "固定残業代の有無": fixed[0],
        "固定残業代（最低額）": fixed[1],
        "固定残業代（最高額）": fixed[2],
        "固定残業代（支払い単位）": fixed[3],
        "固定残業代（時間）": fixed[4],
        "固定残業代（分）": fixed[5],
        "固定残業代（超過分の追加支払への同意）": fixed[6],
        "勤務形態": "固定時間制",
        "平均所定労働時間": sched,
        "社会保険": "健康保険、厚生年金、雇用保険、労災保険",
        "試用期間の有無": pp[0],
        "試用期間（期間）": pp[1],
        "試用期間（期間の単位）": pp[2],
        "試用期間（試用期間中の労働条件）": pp[3],
        "募集要項（仕事内容）": duty,
        "募集要項（アピールポイント）": appeal,
        "募集要項（求める人材）": person,
        "募集要項（勤務時間・曜日）": hours_txt,
        "募集要項（休暇・休日）": holiday_txt,
        "募集要項（勤務地の補足）": loc_txt,
        "募集要項（アクセス）": access,
        "募集要項（給与の補足）": pay.strip(),
        "募集要項（待遇・福利厚生）": benefit,
        "募集要項（その他）": other,
        "掲載画像": "",
        "タグ": tags,
        "採用予定人数": hires,
        "履歴書の有無": "任意",
        "応募者に関する情報": "生年月日、性別、電話番号",
        "応募用メールアドレス": "agent@enroots.co.jp",
        "求人問い合わせ先電話番号（半角）": "090-9189-8178",
        "審査用の質問": "",
        "自動アプローチ利用設定": "利用する",
        "自動アプローチ条件設定": "",
        "ユーザー指定ID": "D",
        "求人ID（編集不可）": "",
    }
    for _k in list(row):
        if _k.startswith("募集要項"):
            row[_k] = compact_bullets(strip_vague_location(row[_k]))

    info = {
        "job_id8": None,
        "company": d["company_name"],
        "name": name,
        "media_publication": det["tags"].get("media_publication"),
        "town": town,
        "month_min": smin,
        "month_max": smax,
        "year_min": y_min,
        "year_max": y_max,
        "low_pay": bool((smin and int(smin) < LOW_MONTH) or (y_min and yen(y_min) < LOW_YEAR)),
        "derived_month": derived,
        "notes": notes,
    }
    return row, info


def verify(rows):
    body = [k for k in rows[0] if k.startswith("募集要項") and k != "募集要項（給与の補足）"]
    for r in rows:
        for f in body + ["職種名", "求人キャッチコピー"]:
            if BODY_MONEY.search(unicodedata.normalize("NFKC", r[f])):
                raise SystemExit(f"給与額が混入: {f} / {r['職種名']}\n---\n{r[f][:400]}")
        for w in TITLE_BANNED:
            if w in r["職種名"]:
                raise SystemExit(f"職種名に禁止語「{w}」: {r['職種名']}")
        for f in body + ["募集要項（給与の補足）"]:
            if re.search(r"[■✔][^\n]*\n\n[■✔]", r[f]):
                raise SystemExit(f"■/✔ 項目間に空行: {f} / {r['職種名']}")
        for f in body + ["職種名", "求人キャッチコピー", "募集要項（給与の補足）"]:
            if AGE_GENDER.search(r[f]):
                bad = [l for l in r[f].split("\n") if AGE_GENDER.search(l)]
                raise SystemExit(f"年齢・性別・国籍の表現: {f} / {r['職種名']}\n{bad[:3]}")
            if AGENT.search(r[f]) or INTERNAL.search(r[f]):
                bad = [l for l in r[f].split("\n") if AGENT.search(l) or INTERNAL.search(l)]
                raise SystemExit(f"エージェント向け／内部基準: {f} / {r['職種名']}\n{bad[:3]}")
            if "【要確認】" in r[f]:
                raise SystemExit(f"【要確認】が本文に残存: {f} / {r['職種名']}")
            if VAGUE_LINE.search(r[f]):
                bad = [l for l in r[f].split("\n") if VAGUE_LINE.search(l)]
                raise SystemExit(
                    f"勤務地が定まらない表現: {f} / {r['職種名']}\n{bad[:3]}")
    for key in ("職種名", "求人キャッチコピー"):
        vals = [r[key] for r in rows]
        dup = {v for v in vals if vals.count(v) > 1}
        if dup:
            raise SystemExit(f"{key} が重複: {dup}")


def main():
    with open(HEADER_SRC, encoding="utf-8-sig", newline="") as f:
        header = next(csv.reader(f))

    order = list(META.keys())
    files = {os.path.basename(p)[:8]: p
             for p in glob.glob(os.path.join(RAW_DIR, "*.json"))
             if not os.path.basename(p).startswith("_")}
    missing = [k for k in order if k not in files]
    if missing:
        raise SystemExit(f"raw JSON が見つかりません: {missing}")
    extra = [k for k in files if k not in META]
    if extra:
        raise SystemExit(f"META に未定義のIDがあります: {extra}")

    rows, infos = [], []
    for k in order:
        payload = json.load(open(files[k], encoding="utf-8"))
        row, info = build_row(payload, META[k], header)
        info["job_id8"] = k
        rows.append(row)
        infos.append(info)

    # 会社ごとに並べる（META の記載順＝会社ごと）
    verify(rows)

    with open(OUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="raise")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in header})
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(infos, f, ensure_ascii=False, indent=1)

    low = sum(1 for i in infos if i["low_pay"])
    der = sum(1 for i in infos if i["derived_month"])
    nonok = sum(1 for i in infos if i["media_publication"] != "媒体掲載OK（社名公開OK）")
    print(f"wrote {os.path.normpath(OUT_CSV)} ({len(rows)} rows / {len(header)} cols)")
    print(f"低給与マーク {low} 件 / 月給を年収から換算 {der} 件 / 社名公開OK以外 {nonok} 件")


if __name__ == "__main__":
    main()
