target: new: deliverables/20260929-gifu-hiroshima-mie-shiga-inspection-packing/README.md
requested_by: 求人作成くん (claude/loving-einstein-9edd43)
summary: 9/29 納品 (岐阜 50 駅・広島 50 駅・三重滋賀 8 市 50 駅の検品・梱包求人 150 行) の README.txt を README.md として置いてほしい
detail: |
  同じフォルダにある README.txt の内容を、そのまま README.md として置く (README.txt はそのまま残してよい)。
  README.txt は 9/28 納品 (deliverables/20260928-aichi-tochigi-inspection-packing/README.md、commit c6119f4)
  と同じ構成で Markdown 記法のまま書いてあるので、拡張子を変えるだけで表・見出しがそのまま使える。
  内容: ファイルと行数、8 列の説明、駅リストの出典と確度 (国土数値情報ベースの乗降客数、Wikipedia の駅記事で所在地確認)、
  町名まで特定できなかった駅、駅の数え方の判断、検証結果 (check.py / lint_sheet.py / lint_posting.py)、未確定事項、駅一覧 150 駅。
reason: md-guard により求人作成くんのセッションからは *.md を書けないため。納品フォルダの README は前回まで README.md で統一しており、体裁をそろえたい。
