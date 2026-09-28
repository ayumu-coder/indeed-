# -*- coding: utf-8 -*-
"""JoBins 公開APIから対象79件のJSONを取得し、deliverables配下に保存する。

GET https://api.jobins.jp/api/public/jobins-shared-job/view/<ID>  (認証不要)

1件ごとに1秒待機し、失敗は1回だけリトライする。
取得結果は deliverables/2026-09-28_ジョビンズ/raw/<ID>.json にそのまま保存する（出典）。
NGは同ディレクトリの _ng.json に記録する。
"""
import json
import os
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(__file__)
OUT_DIR = os.path.join(HERE, "..", "..", "deliverables", "2026-09-28_ジョビンズ", "raw")
API = "https://api.jobins.jp/api/public/jobins-shared-job/view/{}"

# Slack の区分どおりの会社順。会社名はJSONの company_name で上書きせず、README用の区分として保持する。
GROUPS = [
    ("株式会社豊橋園芸ガーデン", [
        "a90fc1e8-f966-11ef-9884-06bbb719f843",
        "19697330-f98a-11ef-b81b-06bbb719f843",
        "2b46878c-f98a-11ef-9386-06bbb719f843",
        "49728768-f98c-11ef-8175-06bbb719f843",
        "d9adc174-f97f-11ef-b3e9-06bbb719f843",
        "b488c63c-f989-11ef-9bc9-06bbb719f843",
        "3c43c8f6-f98a-11ef-8300-06bbb719f843",
        "f69da7f2-f98b-11ef-b2ce-06bbb719f843",
        "2e8a425e-f96b-11ef-94eb-06bbb719f843",
        "4c625a32-f989-11ef-8935-06bbb719f843",
    ]),
    ("株式会社梶川建設", [
        "259f8de0-bf89-11f0-b5b6-0640bc4a0a93",
        "d2bf36f6-bf84-11f0-9f94-0640bc4a0a93",
    ]),
    ("丸洋建設株式会社", [
        "22c1bee2-e38c-11ef-8397-06bbb719f843",
        "b6606ebe-e391-11ef-ab1b-06bbb719f843",
    ]),
    ("松井建拓株式会社", [
        "52609dba-d64a-11f0-88ca-0640bc4a0a93",
        "41f68fb0-fb04-11ef-a708-06bbb719f843",
        "e09ba532-fb00-11ef-9901-06bbb719f843",
    ]),
    ("株式会社マルコオ・ポーロ化工", [
        "0c78c992-0d29-11f1-9604-0640bc4a0a93",
        "1e84ecbe-0d2f-11f1-bdd6-0640bc4a0a93",
        "ada69f60-0d33-11f1-ada8-0640bc4a0a93",
        "162f36ee-0d31-11f1-afcd-0640bc4a0a93",
    ]),
    ("株式会社FD", [
        "076b353c-7441-11ed-9c32-0ad9081f455d",
        "942027ea-6452-11ef-a2df-069972b833b0",
        "c713799a-6452-11ef-ab8e-069972b833b0",
        "20b4fbd3-5b7e-11ee-985e-062753da0059",
    ]),
    ("株式会社大地コンサルタント", [
        "8d53f5d4-087c-11f1-afe0-0640bc4a0a93",
        "d890374e-2805-11f1-bf11-0640bc4a0a93",
        "4db6e5c8-277e-11f1-ac1d-0640bc4a0a93",
        "6dbee28a-280a-11f1-ba53-0640bc4a0a93",
        "b3558b20-0882-11f1-9735-0640bc4a0a93",
        "f60f14f6-280b-11f1-bf4d-0640bc4a0a93",
    ]),
    ("愛知ベース工業株式会社", [
        "54085312-703f-11f1-95d4-0640bc4a0a93",
        "253fc2aa-7c2d-11f1-bf3f-0640bc4a0a93",
        "41df76c0-7c2e-11f1-80e1-0640bc4a0a93",
    ]),
    ("株式会社エヌアイデイ", [
        "ba99e898-b4d8-11ee-9078-062753da0059",
        "ff4748cb-b4d8-11ee-9078-062753da0059",
        "77d7cecc-5b3a-11ee-985e-062753da0059",
    ]),
    ("株式会社エンジニアス", [
        "84a9e502-a745-11f1-8a0d-0622e0780b9d",
        "8400d7dc-a745-11f1-a34a-0622e0780b9d",
        "7c4b8eae-ab2a-11f1-abeb-0640bc4a0a93",
        "165287dc-ab2b-11f1-9bb5-0640bc4a0a93",
        "65fafaba-ab2d-11f1-88c4-0640bc4a0a93",
    ]),
    ("株式会社バーデン", [
        "f6d5c869-5e97-11ee-985e-062753da0059",
        "afbf263b-5e96-11ee-985e-062753da0059",
        "995949c4-ab29-11f1-9b1d-0640bc4a0a93",
    ]),
    ("株式会社ごんだ", [
        "b12482da-96bb-11f1-8198-0640bc4a0a93",
        "a424d8d0-96b8-11f1-80d2-0640bc4a0a93",
    ]),
    ("株式会社エネチタ", [
        "74d352d4-aa7a-11f1-af54-068c8962773d",
    ]),
    ("株式会社テクノプロ テクノプロ・IT社", [
        "7b54f896-057b-11f1-971a-065244483139",
    ]),
    ("株式会社テクノプロ テクノプロ・デザイン社", [
        "530c788c-057b-11f1-9244-065244483139",
        "530d820e-057b-11f1-8ca9-065244483139",
        "532af4d8-057b-11f1-b72f-065244483139",
        "58380d30-057b-11f1-b79b-065244483139",
        "10a0e83e-057b-11f1-9306-065244483139",
        "106b7cf8-057b-11f1-b91b-065244483139",
    ]),
    ("株式会社日立産業制御ソリューションズ", [
        "2982044e-057d-11f1-bce9-065244483139",
        "4ac27c2e-057d-11f1-8485-065244483139",
    ]),
    ("株式会社アクセスネット", [
        "b66c8920-0577-11f1-80de-065244483139",
    ]),
    ("株式会社ビーネックスソリューションズ", [
        "5e52f244-057a-11f1-8766-065244483139",
        "7b9a3808-057a-11f1-93a8-065244483139",
        "7de0f5ac-057a-11f1-a00e-065244483139",
    ]),
    ("株式会社鈴鍵", [
        "a46b14fc-6a27-11f1-8333-0640bc4a0a93",
        "1baa5a86-8720-11f1-af4f-0640bc4a0a93",
    ]),
    ("株式会社グロップ", [
        "fdc6f8e2-0576-11f1-95ca-065244483139",
    ]),
    ("リックス株式会社", [
        "77029290-0575-11f1-9d6d-065244483139",
    ]),
    ("鈴与株式会社", [
        "f6ba0e56-057e-11f1-a1dc-065244483139",
        "f717dc70-057e-11f1-b3d6-065244483139",
    ]),
    ("サイバーコム株式会社", [
        "14d69ed8-0573-11f1-b849-065244483139",
    ]),
    ("IDOM", [
        "6869eaf4-dbd5-11f0-b150-065244483139",
        "6a3e1788-dbd5-11f0-ab4a-065244483139",
    ]),
    ("株式会社メイテックフィルダーズ", [
        "45a5687c-057e-11f1-bcdd-065244483139",
        "4641313a-057e-11f1-bbdc-065244483139",
        "46d6a242-057e-11f1-93d7-065244483139",
        "470a9af2-057e-11f1-a7dc-065244483139",
        "470d549a-057e-11f1-823b-065244483139",
        "4730daf0-057e-11f1-9b24-065244483139",
    ]),
    ("太平産業株式会社", [
        "ebc287ad-ff99-11ed-985e-062753da0059",
    ]),
    ("アドバン・テック", [
        "b4adce48-76f7-11ed-9c32-0ad9081f455d",
        "bdf4edfa-76f7-11ed-9c32-0ad9081f455d",
    ]),
]

ORDER = [(g, i) for g, ids in GROUPS for i in ids]


def fetch(job_id: str) -> dict:
    req = urllib.request.Request(
        API.format(job_id),
        headers={"Accept": "application/json", "User-Agent": "curl/8"},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ng = []
    for n, (group, job_id) in enumerate(ORDER, 1):
        path = os.path.join(OUT_DIR, f"{job_id}.json")
        if os.path.exists(path):
            print(f"{n:3d}/{len(ORDER)} skip {job_id}")
            continue
        for attempt in (1, 2):
            try:
                payload = fetch(job_id)
                if not payload.get("success"):
                    raise ValueError(payload.get("message", "success=false"))
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(payload, f, ensure_ascii=False, indent=1)
                print(f"{n:3d}/{len(ORDER)} ok   {job_id} {group}")
                break
            except (urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
                if attempt == 2:
                    ng.append({"group": group, "job_id": job_id, "error": repr(e)})
                    print(f"{n:3d}/{len(ORDER)} NG   {job_id} {e!r}")
                else:
                    time.sleep(3)
        time.sleep(1)

    with open(os.path.join(OUT_DIR, "_ng.json"), "w", encoding="utf-8") as f:
        json.dump(ng, f, ensure_ascii=False, indent=1)
    print(f"done. total={len(ORDER)} ng={len(ng)}")


if __name__ == "__main__":
    main()
