/**
 * The Indeed 求人一括アップロード sheet, column by column.
 *
 * Every rule here is lifted from the template's own 入力方法 tab, so the schema and the
 * workbook it fills can never drift apart. `required` is the unconditional requirement
 * only — Indeed's conditional rules ("必須 unless 雇用形態 is インターン", …) are not
 * modelled: this tool is allowed to leave a cell blank, so a wrong guess would be worse
 * than no guess.
 */

export const FIELD_KEYS = [
  'status',
  'companyName',
  'jobTitle',
  'jobCategory',
  'catchCopy',
  'postalCode',
  'addressArea',
  'addressStreet',
  'addressBuilding',
  'employmentType',
  'paidPlacement',
  'salaryType',
  'salaryMin',
  'salaryMax',
  'salaryDisplay',
  'fixedOvertimePresence',
  'fixedOvertimeMin',
  'fixedOvertimeMax',
  'fixedOvertimeUnit',
  'fixedOvertimeHours',
  'fixedOvertimeMinutes',
  'fixedOvertimeExcessConsent',
  'workStyle',
  'scheduledHours',
  'scheduledMinutes',
  'socialInsurance',
  'socialInsuranceExemptionReason',
  'probationPresence',
  'probationLength',
  'probationLengthUnit',
  'probationConditions',
  'probationSalaryType',
  'probationSalaryMin',
  'probationSalaryMax',
  'probationSalaryDisplay',
  'probationFixedOvertimePresence',
  'probationFixedOvertimeMin',
  'probationFixedOvertimeMax',
  'probationFixedOvertimeUnit',
  'probationFixedOvertimeHours',
  'probationFixedOvertimeMinutes',
  'probationFixedOvertimeExcessConsent',
  'probationScheduledHours',
  'probationScheduledMinutes',
  'probationOtherConditions',
  'descriptionJob',
  'descriptionAppeal',
  'descriptionCandidate',
  'descriptionSchedule',
  'descriptionHolidays',
  'descriptionLocationNote',
  'descriptionAccess',
  'descriptionSalaryNote',
  'descriptionBenefits',
  'descriptionOther',
  'images',
  'tags',
  'plannedHires',
  'resumeRequirement',
  'applicantInfo',
  'applicationEmail',
  'inquiryPhone',
  'screeningQuestions',
  'autoApproachEnabled',
  'autoApproachCriteria',
  'externalId',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

/** How a value is written into the cell. */
export type FieldKind = 'text' | 'number' | 'postalCode' | 'phone' | 'email';

export interface FieldSpec {
  readonly key: FieldKey;
  /** Header text in row 1. Must match the template byte for byte. */
  readonly header: string;
  readonly kind: FieldKind;
  /** Adjacent columns Indeed reserves for this field (タグ and 応募者に関する情報 get 3). */
  readonly slots: number;
  /** Unconditionally required by Indeed. Conditional requirements are not modelled. */
  readonly required: boolean;
  /** Closed set of accepted values, or null for free input. */
  readonly allowed: readonly string[] | null;
  /** Whether several values may be listed (comma separated / spread over the slots). */
  readonly multi: boolean;
  /** Cap Indeed puts on the number of values, or null when the only cap is `slots`. */
  readonly maxValues: number | null;
  /** Indeed rejects newlines in this field. */
  readonly singleLine: boolean;
  /** Hard cap on characters, or null when Indeed states none. */
  readonly maxChars: number | null;
  /** Told verbatim to the extractor. Keep it about *what the value is*, not formatting. */
  readonly guidance: string;
}

const SALARY_TYPES = ['時給', '日給', '週給', '月給', '年俸', '完全歩合'] as const;
const SALARY_DISPLAYS = ['範囲で表示', '最低額を表示', '固定額を表示'] as const;
const OVERTIME_UNITS = ['日当たり', '週当たり', '月当たり'] as const;
const PRESENCE = ['あり', 'なし'] as const;

function text(
  key: FieldKey,
  header: string,
  guidance: string,
  extra: Partial<FieldSpec> = {},
): FieldSpec {
  return {
    key,
    header,
    kind: 'text',
    slots: 1,
    required: false,
    allowed: null,
    multi: false,
    maxValues: null,
    singleLine: false,
    maxChars: null,
    guidance,
    ...extra,
  };
}

function number(key: FieldKey, header: string, guidance: string, required = false): FieldSpec {
  return text(key, header, guidance, { kind: 'number', required });
}

export const FIELDS: readonly FieldSpec[] = [
  text('status', 'ステータス', '掲載ステータス。通常は「募集中」。', {
    allowed: ['募集中', '休止中'],
  }),
  text('companyName', '会社名', '求職者を直接雇用する採用企業の名称。', { required: true }),
  text('jobTitle', '職種名', '募集している職種名。', { required: true }),
  text('jobCategory', '職業カテゴリー', 'Indeedの職業カテゴリー名。最大3つ。', {
    multi: true,
    maxValues: 3,
  }),
  text('catchCopy', '求人キャッチコピー', '求人の一文キャッチコピー。改行不可。', {
    maxChars: 256,
    singleLine: true,
  }),
  text('postalCode', '勤務地（郵便番号）', '勤務地の郵便番号。', { kind: 'postalCode' }),
  text('addressArea', '勤務地（都道府県・市区町村・町域）', '都道府県・市区町村・町域まで。', {
    required: true,
  }),
  text('addressStreet', '勤務地（丁目・番地・号）', '丁目・番地・号のみ。'),
  text('addressBuilding', '勤務地（建物名・階数）', '建物名と階数のみ。'),
  text('employmentType', '雇用形態', '雇用形態。', {
    required: true,
    multi: true,
    allowed: [
      '正社員',
      'アルバイト・パート',
      '派遣社員',
      '契約社員',
      '業務委託',
      'インターン',
      'ボランティア',
      '新卒',
    ],
  }),
  text('paidPlacement', '有料職業紹介に該当', '有料職業紹介事業に該当するか。', {
    required: true,
    allowed: ['はい', 'いいえ'],
  }),
  text('salaryType', '給与形態', '給与形態。', { required: true, allowed: [...SALARY_TYPES] }),
  number('salaryMin', '給与（最低額）', '給与の最低額を数字のみで。', true),
  number('salaryMax', '給与（最高額）', '給与の最高額を数字のみで。'),
  text('salaryDisplay', '給与（表示形式）', '求人票での給与の見せ方。', {
    required: true,
    allowed: [...SALARY_DISPLAYS],
  }),
  text('fixedOvertimePresence', '固定残業代の有無', '固定残業代（みなし残業代）の有無。', {
    required: true,
    allowed: [...PRESENCE],
  }),
  number('fixedOvertimeMin', '固定残業代（最低額）', '固定残業代の最低額。', true),
  number('fixedOvertimeMax', '固定残業代（最高額）', '固定残業代の最高額。'),
  text('fixedOvertimeUnit', '固定残業代（支払い単位）', '固定残業代の支払い単位。', {
    required: true,
    allowed: [...OVERTIME_UNITS],
  }),
  number('fixedOvertimeHours', '固定残業代（時間）', '固定残業代に含まれる残業時間（時間）。', true),
  number('fixedOvertimeMinutes', '固定残業代（分）', '固定残業代に含まれる残業時間の分（1〜59）。'),
  text(
    'fixedOvertimeExcessConsent',
    '固定残業代（超過分の追加支払への同意）',
    '超過分を追加支給することへの同意。同意する場合のみ「はい」。',
    { required: true, allowed: ['はい'] },
  ),
  text('workStyle', '勤務形態', '労働時間制度。', {
    required: true,
    allowed: [
      '専門業務型裁量労働制',
      '事業場外みなし労働時間制',
      '固定時間制',
      'シフト制',
      '企画業務型裁量労働制',
      '変形労働時間制',
      '高度プロフェッショナル制度',
      'フレックスタイム制度',
    ],
  }),
  number('scheduledHours', '平均所定労働時間', '給与形態に対応する期間の平均所定労働時間。', true),
  number('scheduledMinutes', '平均所定労働時間（分）', '平均所定労働時間の分（1〜59）。'),
  text('socialInsurance', '社会保険', '適用される社会保険。', {
    required: true,
    multi: true,
    allowed: ['健康保険', '厚生年金', '雇用保険', '労災保険'],
  }),
  text(
    'socialInsuranceExemptionReason',
    '社会保険（適用されない理由）',
    '社会保険がすべて適用されない場合の理由。',
    { required: true },
  ),
  text('probationPresence', '試用期間の有無', '試用期間の有無。', {
    required: true,
    allowed: [...PRESENCE],
  }),
  number('probationLength', '試用期間（期間）', '試用期間の長さ（数字）。', true),
  text('probationLengthUnit', '試用期間（期間の単位）', '試用期間の単位。', {
    required: true,
    allowed: ['日間', '週間', 'か月'],
  }),
  text(
    'probationConditions',
    '試用期間（試用期間中の労働条件）',
    '試用期間中の労働条件が本採用と同じか。',
    { required: true, allowed: ['同条件', '異なる'] },
  ),
  text('probationSalaryType', '試用期間中の給与形態', '試用期間中の給与形態。', {
    required: true,
    allowed: SALARY_TYPES.filter((value) => value !== '完全歩合'),
  }),
  number('probationSalaryMin', '試用期間中の給与（最低額）', '試用期間中の給与の最低額。', true),
  number('probationSalaryMax', '試用期間中の給与（最高額）', '試用期間中の給与の最高額。'),
  text('probationSalaryDisplay', '試用期間中の給与（表示形式）', '試用期間中の給与の見せ方。', {
    required: true,
    allowed: [...SALARY_DISPLAYS],
  }),
  text('probationFixedOvertimePresence', '試用期間中の固定残業代の有無', '試用期間中の固定残業代の有無。', {
    required: true,
    allowed: [...PRESENCE],
  }),
  number('probationFixedOvertimeMin', '試用期間中の固定残業代（最低額）', '試用期間中の固定残業代の最低額。', true),
  number('probationFixedOvertimeMax', '試用期間中の固定残業代（最高額）', '試用期間中の固定残業代の最高額。'),
  text('probationFixedOvertimeUnit', '試用期間中の固定残業代（支払い単位）', '試用期間中の固定残業代の支払い単位。', {
    required: true,
    allowed: [...OVERTIME_UNITS],
  }),
  number('probationFixedOvertimeHours', '試用期間中の固定残業代（時間）', '試用期間中の固定残業代に含まれる残業時間。', true),
  number('probationFixedOvertimeMinutes', '試用期間中の固定残業代（分）', '試用期間中の固定残業代の分（1〜59）。'),
  text(
    'probationFixedOvertimeExcessConsent',
    '試用期間中の固定残業代（超過分の追加支払への同意）',
    '試用期間中の超過分を追加支給することへの同意。',
    { required: true, allowed: ['はい'] },
  ),
  number('probationScheduledHours', '試用期間中の平均所定労働時間', '試用期間中の平均所定労働時間。', true),
  number('probationScheduledMinutes', '試用期間中の平均所定労働時間（分）', '試用期間中の平均所定労働時間の分（1〜59）。'),
  text('probationOtherConditions', '試用期間中のその他の条件', '試用期間中に異なるその他の条件。', {
    required: true,
  }),
  text('descriptionJob', '募集要項（仕事内容）', '仕事内容の本文。', { required: true }),
  text('descriptionAppeal', '募集要項（アピールポイント）', '職場や事業のアピールポイント。'),
  text('descriptionCandidate', '募集要項（求める人材）', '応募資格・歓迎スキル。'),
  text('descriptionSchedule', '募集要項（勤務時間・曜日）', '勤務時間、休憩、残業、勤務曜日。', {
    required: true,
  }),
  text('descriptionHolidays', '募集要項（休暇・休日）', '休日・休暇制度。'),
  text('descriptionLocationNote', '募集要項（勤務地の補足）', '転勤、出張、受動喫煙対策などの補足。'),
  text('descriptionAccess', '募集要項（アクセス）', '最寄駅からの経路など。'),
  text('descriptionSalaryNote', '募集要項（給与の補足）', '昇給・賞与・各種手当の補足。'),
  text('descriptionBenefits', '募集要項（待遇・福利厚生）', '待遇と福利厚生。'),
  text('descriptionOther', '募集要項（その他）', '企業概要、選考フローなどその他の情報。'),
  text('images', '掲載画像', 'Indeedダッシュボードで採番済みの画像ID。最大15件。', {
    multi: true,
    maxValues: 15,
  }),
  text('tags', 'タグ', '求人に付けるタグ。', {
    slots: 3,
    multi: true,
    allowed: [
      '社員登用あり',
      '昇給・昇格あり',
      '残業なし',
      '週1日からOK',
      '週2・3日からOK',
      'シフト自由',
      '交通費支給',
      '即日勤務OK',
      '駅近5分以内',
      'フルリモート',
      '在宅OK',
    ],
  }),
  text('plannedHires', '採用予定人数', '採用予定人数。', {
    required: true,
    allowed: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11人以上', '常時募集'],
  }),
  text('resumeRequirement', '履歴書の有無', '応募時に履歴書を必須とするか。', {
    allowed: ['必須', '任意'],
  }),
  text('applicantInfo', '応募者に関する情報', '応募時に取得する応募者情報。', {
    slots: 3,
    multi: true,
    allowed: ['電話番号', '性別', '生年月日', '職歴', '資格・免許', 'スキル', '学歴', '住所'],
  }),
  text('applicationEmail', '応募用メールアドレス', '応募通知の宛先メールアドレス。', {
    kind: 'email',
    required: true,
    multi: true,
  }),
  text('inquiryPhone', '求人問い合わせ先電話番号（半角）', '求職者からの問い合わせ先電話番号。', {
    kind: 'phone',
  }),
  text('screeningQuestions', '審査用の質問', '審査用の質問のYAML。原文にない場合は空欄。'),
  text('autoApproachEnabled', '自動アプローチ利用設定', '自動アプローチを利用するか。', {
    allowed: ['利用する', '利用しない'],
  }),
  text('autoApproachCriteria', '自動アプローチ条件設定', '自動アプローチの条件YAML。原文にない場合は空欄。'),
  text('externalId', 'ユーザー指定ID', '社内で使う求人の識別子。', { maxChars: 30 }),
];

export const FIELD_BY_KEY: ReadonlyMap<FieldKey, FieldSpec> = new Map(
  FIELDS.map((field) => [field.key, field]),
);

/**
 * How many values may be written for a field: its own documented cap, else one per slot for
 * a repeated field, else unbounded for a comma-separated single cell, else exactly one.
 */
export function valueCapacity(spec: FieldSpec): number {
  if (spec.maxValues !== null) return spec.maxValues;
  if (spec.slots > 1) return spec.slots;
  return spec.multi ? Number.POSITIVE_INFINITY : 1;
}

/** Total columns the sheet occupies, counting the repeated タグ / 応募者に関する情報 slots. */
export const COLUMN_COUNT: number = FIELDS.reduce((total, field) => total + field.slots, 0);
