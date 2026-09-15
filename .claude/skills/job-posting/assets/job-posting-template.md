# 求人原稿テンプレート（Indeed 掲載用）

セクション 0 で情報を集め、セクション 1 の型に流し込む。
埋まらない項目は推測せず `{{要確認: 項目名}}` のまま残す。

文章の作法は `../references/writing.md`、検品は `../references/legal.md` を参照。

---

## 0. ヒアリングシート（原稿を書く前に必ず埋める）

未確定の項目は空欄のままにせず `要確認` と書く。**推測で原稿に書かない**（労働条件の虚偽・誤認表示は職業安定法違反になる）。

| 項目 | 内容 | 必須 |
| --- | --- | --- |
| 企業名 | {{company}} | ✅ |
| 事業内容 | {{businessDescription}} | ✅ |
| 募集職種 | {{jobTitle}} | ✅ |
| 雇用形態 | {{employmentType}}（正社員 / 契約社員 / パート・アルバイト / 業務委託 / 派遣） | ✅ |
| 募集背景 | {{hiringReason}}（増員 / 欠員補充 / 新規事業） | |
| 採用人数 | {{headcount}} | |
| 仕事内容（具体タスク） | {{tasks}} | ✅ |
| 業務の変更の範囲 | {{taskChangeScope}} | ✅ |
| 就業場所 | {{workLocation}}（住所・最寄駅・徒歩分数） | ✅ |
| 就業場所の変更の範囲 | {{locationChangeScope}} | ✅ |
| 給与形態 | {{payType}}（月給 / 日給 / 時給 / 年俸） | ✅ |
| 給与レンジ | {{payMin}} 〜 {{payMax}} 円 | ✅ |
| 固定残業代 | {{fixedOvertime}}（有無・金額・相当時間数） | ✅ |
| 昇給・賞与 | {{raiseBonus}} | |
| 勤務時間 | {{workingHours}}（休憩・所定労働時間） | ✅ |
| 時間外労働 | {{overtime}}（月平均◯時間） | |
| 休日休暇 | {{holidays}}（年間休日数） | ✅ |
| 待遇・福利厚生 | {{benefits}}（社会保険・交通費上限・退職金など） | ✅ |
| 加入保険 | {{insurance}} | ✅ |
| 応募資格（必須） | {{requiredSkills}} | ✅ |
| 歓迎スキル | {{preferredSkills}} | |
| 契約期間 | {{contractPeriod}}（期間の定めの有無・更新上限・無期転換） | ✅ |
| 試用期間 | {{probation}}（期間・期間中の条件差異） | ✅ |
| 受動喫煙防止措置 | {{smokingPolicy}} | ✅ |
| 選考フロー | {{selectionFlow}} | ✅ |
| 選考リードタイム | {{leadTime}} | |
| 訴求ポイント上位3つ | {{sellingPoints}} | ✅ |
| 競合求人との差分 | {{differentiator}} | |
| ターゲット像 | {{targetPersona}}（年代・経験・転職理由） | ✅ |
| NG 表現・掲載不可情報 | {{prohibited}} | |

---

## 1. 求人原稿（納品物）

### 職種名

```
{{jobTitleCopy}}
```

- 組み立て方と NG 表記は `../references/writing.md#職種名の組み立て` を参照。

### 仕事内容

```
■ 業務概要
{{jobSummary}}

■ 具体的な業務
・{{task1}}
・{{task2}}
・{{task3}}

■ 1日の流れ
{{dailySchedule}}

■ 入社後のフォロー
{{onboarding}}

■ 従事すべき業務の変更の範囲
{{taskChangeScope}}
```

- 冒頭 2〜3 行で「誰が・何を・誰に対して」が分かるようにする（検索結果のスニペットに出る）。
- 抽象語（`幅広い業務`／`色々な仕事`）は禁止。動詞で書く。
- **業務の変更の範囲**は 2024/4/1 施行の労働条件明示ルールで必須。

### 給与

```
{{payType}} {{payMin}}円 〜 {{payMax}}円

■ 固定残業代
{{fixedOvertime}}

■ 昇給・賞与
{{raiseBonus}}

■ モデル年収
{{modelIncome}}
```

- 下限額は**必ず最低賃金以上**（地域別最低賃金の改定月をまたぐ原稿は要再確認）。
- レンジ表示のとき「経験・能力を考慮し決定」を添える。上限だけの表示（`〜50万円`）は不可。
- 固定残業代がある場合は **3点セットを必ず明示**: ①固定残業代の額 ②相当する時間数 ③超過分は別途支給する旨。1つでも欠けると違法表示。

### 勤務地

```
{{workLocation}}
最寄駅：{{nearestStation}}（徒歩{{walkMinutes}}分）
受動喫煙防止措置：{{smokingPolicy}}

■ 就業場所の変更の範囲
{{locationChangeScope}}
```

- 「本社および各支店」だけの表記は不可。実際に就業する住所を書く。
- 転勤の有無を明記する。

### 勤務時間・休日休暇

```
勤務時間：{{workingHours}}（休憩{{breakMinutes}}分／所定労働{{contractedHours}}時間）
時間外労働：{{overtime}}
休日：{{holidays}}（年間休日{{annualHolidays}}日）
休暇：{{leaves}}
```

### 応募資格

```
【必須】
・{{requiredSkills}}

【歓迎】
・{{preferredSkills}}
```

- 年齢・性別・国籍・居住地・家族構成による限定は**原則として書けない**（`../references/legal.md` の #1〜#4 を参照）。

### 待遇・福利厚生

```
・加入保険：{{insurance}}
・交通費：{{commuteAllowance}}（上限{{commuteCap}}円/月）
・{{benefits}}
```

### 雇用形態・契約期間

```
雇用形態：{{employmentType}}
契約期間：{{contractPeriod}}
試用期間：{{probation}}（期間中の労働条件：{{probationTerms}}）
```

- 有期契約なら**更新の有無・更新上限・無期転換申込機会と転換後の労働条件**まで書く。
- 試用期間中に条件が下がる場合は、その条件を明示する（書かないと本採用条件が適用される）。

### 選考フロー

```
{{selectionFlow}}
（例：書類選考 → 一次面接（オンライン） → 最終面接 → 内定）
応募から内定まで：{{leadTime}}
```

### この求人の魅力（訴求）

```
・{{sellingPoint1}}
・{{sellingPoint2}}
・{{sellingPoint3}}
```

- 主観形容詞（`アットホーム`／`風通しが良い`）を**数字か事実に置き換える**。
  例）`アットホームな職場` → `平均年齢32歳・20〜30代が7割`
