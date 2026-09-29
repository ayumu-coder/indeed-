// このファイルは自動生成です。直接編集せず lib/*.js と gas/src/entry.js を編集し、
// line-autoreply/ で `npm run build` を実行してください。
// Apps Script エディタにはこのファイルの全文をそのまま貼り付けます。

// ===== lib/auth.js =====
// Webhook リクエストの認証 (純粋関数)。
//
// LINE Messaging API は X-Line-Signature ヘッダに
// base64(HMAC-SHA256(channelSecret, rawBody)) を載せて送ってくる。
// ただし Google Apps Script の doPost はリクエストヘッダを受け取れないため、
// GAS 上では署名が取れない。その場合は
//   1. Webhook URL に付けた秘密トークン (?token=...) の一致
//   2. body.destination (送信先ボットのユーザー ID) の一致 (設定されていれば)
// で代替する。署名ヘッダが取れる環境では署名を必ず検証する。

/**
 * タイミング攻撃に配慮した文字列比較。
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * X-Line-Signature を検証する。
 * @param {string} body 受信した生のリクエストボディ
 * @param {unknown} signatureHeader X-Line-Signature ヘッダの値
 * @param {unknown} channelSecret チャネルシークレット
 * @param {(value: string, key: string) => string} hmacSha256Base64 環境依存の HMAC 実装
 * @returns {boolean}
 */
function verifyLineSignature(body, signatureHeader, channelSecret, hmacSha256Base64) {
  if (typeof body !== 'string') return false;
  if (typeof channelSecret !== 'string' || channelSecret === '') return false;
  if (typeof signatureHeader !== 'string' || signatureHeader === '') return false;
  const expected = hmacSha256Base64(body, channelSecret);
  return constantTimeEqual(expected, signatureHeader);
}

/**
 * @typedef {object} AuthInput
 * @property {string} body
 * @property {string | null | undefined} signatureHeader  取得できなければ null
 * @property {string | null | undefined} channelSecret
 * @property {(value: string, key: string) => string} hmacSha256Base64
 * @property {string | null | undefined} queryToken       URL の ?token= の値
 * @property {string | null | undefined} webhookToken     スクリプトプロパティ WEBHOOK_TOKEN
 * @property {string | null | undefined} destination      body.destination
 * @property {string | null | undefined} botUserId        スクリプトプロパティ LINE_BOT_USER_ID (任意)
 */

/**
 * @typedef {object} AuthResult
 * @property {boolean} ok
 * @property {'signature' | 'token' | 'none'} method
 * @property {string} reason
 */

/**
 * Webhook リクエストを認証する。
 * 署名ヘッダがあれば署名のみで判定し、無ければトークン方式にフォールバックする。
 * @param {AuthInput} input
 * @returns {AuthResult}
 */
function authenticateWebhookRequest(input) {
  const signatureHeader = input.signatureHeader ?? null;

  if (signatureHeader !== null) {
    const ok = verifyLineSignature(
      input.body,
      signatureHeader,
      input.channelSecret,
      input.hmacSha256Base64,
    );
    return ok
      ? { ok: true, method: 'signature', reason: 'signature_ok' }
      : { ok: false, method: 'signature', reason: 'signature_mismatch' };
  }

  const webhookToken = input.webhookToken ?? '';
  if (webhookToken === '') {
    return { ok: false, method: 'none', reason: 'no_signature_and_no_webhook_token' };
  }
  if (!constantTimeEqual(input.queryToken ?? '', webhookToken)) {
    return { ok: false, method: 'token', reason: 'token_mismatch' };
  }
  const botUserId = input.botUserId ?? '';
  if (botUserId !== '' && !constantTimeEqual(input.destination ?? '', botUserId)) {
    return { ok: false, method: 'token', reason: 'destination_mismatch' };
  }
  return { ok: true, method: 'token', reason: 'token_ok' };
}

// ===== lib/events.js =====
// LINE Webhook のボディ解析とイベント → シート行の変換 (純粋関数)。


/** Google スプレッドシートのセル上限は 50,000 文字。余裕をみて切り詰める。 */
const MAX_CELL_CHARS = 40000;

/**
 * @typedef {object} WebhookBody
 * @property {string} destination
 * @property {Record<string, any>[]} events
 */

/**
 * 受信ボディを解析する。形が不正なら例外。
 * LINE の「検証」ボタンは events が空配列のボディを送るので、それは正常とみなす。
 * @param {string} text
 * @returns {WebhookBody}
 */
function parseWebhookBody(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('リクエストボディが空です');
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('リクエストボディが JSON ではありません');
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('リクエストボディがオブジェクトではありません');
  }
  const events = json.events === undefined ? [] : json.events;
  if (!Array.isArray(events)) {
    throw new Error('events が配列ではありません');
  }
  for (const ev of events) {
    if (ev === null || typeof ev !== 'object' || typeof ev.type !== 'string') {
      throw new Error('events に不正な要素があります');
    }
  }
  return {
    destination: typeof json.destination === 'string' ? json.destination : '',
    events,
  };
}

/**
 * セルに入れる値を無害化する。
 * - 先頭が = + - @ の文字列は数式として解釈されるため、先頭にアポストロフィを付けて文字列扱いにする。
 * - 長すぎる文字列は切り詰める。
 * @param {unknown} value
 * @returns {string | number | boolean}
 */
function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (s.length > MAX_CELL_CHARS) s = `${s.slice(0, MAX_CELL_CHARS)}…(切り詰め)`;
  return s;
}

/**
 * メッセージ本体を 1 行の文字列に要約する。テキスト以外は種別と ID を残す。
 * @param {Record<string, any> | undefined} message
 * @returns {string}
 */
function describeMessage(message) {
  if (!message || typeof message !== 'object') return '';
  const id = message.id ? ` id=${message.id}` : '';
  switch (message.type) {
    case 'text':
      return typeof message.text === 'string' ? message.text : '';
    case 'sticker':
      return `[スタンプ packageId=${message.packageId ?? ''} stickerId=${message.stickerId ?? ''}]`;
    case 'image':
      return `[画像${id}]`;
    case 'video':
      return `[動画${id}]`;
    case 'audio':
      return `[音声${id}]`;
    case 'file':
      return `[ファイル ${message.fileName ?? ''}${id}]`;
    case 'location':
      return `[位置情報 ${message.title ?? ''} ${message.address ?? ''}]`.replace(/\s+/g, ' ').trim();
    default:
      return `[${message.type ?? 'unknown'}${id}]`;
  }
}

/**
 * メッセージ以外のイベントを 1 行の文字列に要約する。
 * @param {Record<string, any>} event
 * @returns {string}
 */
function describeNonMessageEvent(event) {
  const members = (list) =>
    Array.isArray(list) ? list.map((m) => m?.userId ?? '').filter(Boolean).join(',') : '';
  switch (event.type) {
    case 'join':
      return '[グループに参加]';
    case 'leave':
      return '[グループから退出]';
    case 'memberJoined':
      return `[メンバー参加 ${members(event.joined?.members)}]`;
    case 'memberLeft':
      return `[メンバー退出 ${members(event.left?.members)}]`;
    case 'follow':
      return '[友だち追加]';
    case 'unfollow':
      return '[ブロック]';
    case 'postback':
      return `[postback ${event.postback?.data ?? ''}]`;
    case 'unsend':
      return `[送信取消 messageId=${event.unsend?.messageId ?? ''}]`;
    default:
      return `[${event.type}]`;
  }
}

/**
 * イベント 1 件を「会話ログ」の 1 行に変換する。列順は CONVERSATION_LOG.headers と一致する。
 * @param {Record<string, any>} event
 * @param {Date} receivedAt
 * @returns {(string | number | boolean)[]}
 */
function eventToRow(event, receivedAt) {
  const source = event.source && typeof event.source === 'object' ? event.source : {};
  const message = event.type === 'message' ? event.message : undefined;
  const body = message ? describeMessage(message) : describeNonMessageEvent(event);
  const timestamp = typeof event.timestamp === 'number' ? formatJst(event.timestamp) : '';

  const row = [
    formatJst(receivedAt),
    event.type,
    source.type ?? '',
    source.groupId ?? source.roomId ?? '',
    source.userId ?? '',
    message?.type ?? '',
    body,
    event.replyToken ?? '',
    STATUS.PENDING,
    event.webhookEventId ?? '',
    event.deliveryContext?.isRedelivery === true,
    timestamp,
    '',
    '',
    JSON.stringify(event),
  ].map(sanitizeCell);

  if (row.length !== CONVERSATION_LOG.headers.length) {
    throw new Error('会話ログの列数と行の長さが一致しません');
  }
  return row;
}

// ===== lib/queue.js =====
// 「設定」シートの解釈と「会話ログ」の未処理行の抽出 (純粋関数)。


/**
 * 「設定」シートのデータ行 (見出し除く) を key→value に変換する。
 * 空キーは無視し、同じキーは後勝ち。値は文字列化して trim する。
 * @param {readonly (readonly unknown[])[]} rows
 * @returns {Record<string, string>}
 */
function parseSettings(rows) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const row of rows) {
    const key = String(row?.[0] ?? '').trim();
    if (key === '') continue;
    out[key] = String(row?.[1] ?? '').trim();
  }
  return out;
}

/**
 * @typedef {object} ModeResolution
 * @property {'approval' | 'auto'} mode
 * @property {string | null} warning 不正値だった場合の説明。正常なら null
 */

/**
 * 送信モードを決める。未設定・不正値は安全側 (approval) に倒す。
 * @param {Record<string, string>} settings
 * @returns {ModeResolution}
 */
function resolveMode(settings) {
  const raw = (settings[SETTING_KEYS.MODE] ?? '').toLowerCase();
  if (raw === '') {
    return { mode: DEFAULT_MODE, warning: `設定 ${SETTING_KEYS.MODE} が未設定のため ${DEFAULT_MODE} で動作` };
  }
  if (!MODES.includes(raw)) {
    return {
      mode: DEFAULT_MODE,
      warning: `設定 ${SETTING_KEYS.MODE}=「${raw}」は不正 (${MODES.join(' | ')}) のため ${DEFAULT_MODE} で動作`,
    };
  }
  return { mode: /** @type {'approval' | 'auto'} */ (raw), warning: null };
}

/**
 * 状態が「未処理」のデータ行 (0 始まり、見出しを除いた配列内の添字) を古い順に返す。
 * @param {readonly (readonly unknown[])[]} rows 見出しを除いたデータ行
 * @param {number} statusColumnIndex
 * @param {number} limit 1 回に処理する最大件数
 * @returns {number[]}
 */
function findPendingRowIndexes(rows, statusColumnIndex, limit) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit は正の整数');
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < rows.length && out.length < limit; i += 1) {
    if (rows[i]?.[statusColumnIndex] === STATUS.PENDING) out.push(i);
  }
  return out;
}

// ===== lib/schema.js =====
// スプレッドシートの構成定義 (純粋データ)。
// setup() と eventToRow() が同じ定義を参照する。

const STATUS = Object.freeze({
  PENDING: '未処理',
  DONE: '処理済',
  ERROR: 'エラー',
});

const LEDGER_KIND = Object.freeze({
  CLIENT: '取引先',
  INTERNAL: '社内',
});

const SETTING_KEYS = Object.freeze({
  MODE: 'mode',
});

const MODES = Object.freeze(['approval', 'auto']);
const DEFAULT_MODE = 'approval';

/**
 * @typedef {object} SheetDefinition
 * @property {string} name
 * @property {readonly string[]} headers
 * @property {readonly (readonly string[])[]} [initialRows]
 */

/** @type {SheetDefinition} */
const CONVERSATION_LOG = Object.freeze({
  name: '会話ログ',
  headers: Object.freeze([
    '受信日時',
    'イベント種別',
    'ソース種別',
    'グループID',
    'ユーザーID',
    'メッセージ種別',
    '本文',
    'replyToken',
    '状態',
    'webhookEventId',
    '再送',
    'LINEタイムスタンプ',
    '処理日時',
    '処理メモ',
    '生データ',
  ]),
});

/** @type {SheetDefinition} */
const LEDGER = Object.freeze({
  name: '取引先台帳',
  headers: Object.freeze([
    'グループID',
    '会社名',
    'グループ名',
    '区分',
    '共有スプレッドシートID',
    '共有フォルダID',
    '担当者',
    '有効',
    '備考',
  ]),
});

/** @type {SheetDefinition} */
const SETTINGS = Object.freeze({
  name: '設定',
  headers: Object.freeze(['キー', '値', '説明']),
  initialRows: Object.freeze([
    Object.freeze([
      SETTING_KEYS.MODE,
      DEFAULT_MODE,
      'approval=承認してから送る / auto=自動送信',
    ]),
  ]),
});

/** @type {SheetDefinition} */
const OPS_LOG = Object.freeze({
  name: '稼働ログ',
  headers: Object.freeze(['日時', 'レベル', '処理', 'グループID', '内容']),
});

/** @type {readonly SheetDefinition[]} */
const ALL_SHEETS = Object.freeze([CONVERSATION_LOG, LEDGER, SETTINGS, OPS_LOG]);

/**
 * 見出し名から 0 始まりの列インデックスを返す。無ければ例外。
 * @param {SheetDefinition} def
 * @param {string} header
 * @returns {number}
 */
function columnIndex(def, header) {
  const i = def.headers.indexOf(header);
  if (i < 0) throw new Error(`シート「${def.name}」に見出し「${header}」がありません`);
  return i;
}

// ===== lib/time.js =====
// 日時ユーティリティ (純粋関数)。Node / GAS 双方で動く。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Date を "YYYY-MM-DD HH:mm:ss" (JST) に整形する。
 * 不正な値は空文字を返す (ログ行を落とさないため例外にしない)。
 * @param {Date | number | string} value
 * @returns {string}
 */
function formatJst(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  const t = new Date(ms + JST_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ` +
    `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`
  );
}

// ===== Google Apps Script 固有部分 =====
// このファイルは Node では動かない (SpreadsheetApp 等を使う)。
// `npm run build` で lib/*.js と結合して gas/Code.gs になる。

/** スクリプトプロパティのキー名 */
const PROP = Object.freeze({
  CHANNEL_SECRET: 'LINE_CHANNEL_SECRET',
  CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  ADMIN_USER_ID: 'ADMIN_USER_ID',
  WEBHOOK_TOKEN: 'WEBHOOK_TOKEN',
  BOT_USER_ID: 'LINE_BOT_USER_ID',
});

/** 1 分トリガー 1 回あたりに処理する最大件数 */
const PROCESS_BATCH_SIZE = 50;

/** トリガーが呼ぶ処理関数名 */
const QUEUE_HANDLER_NAME = 'processQueue';

// ---------- Webhook 受け口 ----------

/**
 * LINE からの Webhook。認証 → 会話ログへ記録 → 即応答。
 * GAS の Web アプリは常に HTTP 200 を返すため、本文で結果を区別する。
 * @param {GoogleAppsScript.Events.DoPost} e
 */
function doPost(e) {
  const receivedAt = new Date();
  try {
    const body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    const props = PropertiesService.getScriptProperties();

    // 認証前に解析失敗で ERROR を残さないよう、ここでは失敗を null に丸める。
    let parsed = null;
    let parseError = null;
    try {
      parsed = parseWebhookBody(body);
    } catch (err) {
      parseError = err;
    }

    const auth = authenticateWebhookRequest({
      body,
      signatureHeader: getSignatureHeader(e),
      channelSecret: props.getProperty(PROP.CHANNEL_SECRET),
      hmacSha256Base64,
      queryToken: e && e.parameter ? e.parameter.token : null,
      webhookToken: props.getProperty(PROP.WEBHOOK_TOKEN),
      destination: parsed ? parsed.destination : '',
      botUserId: props.getProperty(PROP.BOT_USER_ID),
    });
    if (!auth.ok) {
      logOps('WARN', 'doPost', '', `認証失敗: ${auth.reason}`);
      return textResponse('forbidden');
    }
    if (!parsed) {
      throw parseError || new Error('リクエストボディを解析できません');
    }

    if (parsed.events.length > 0) {
      const rows = parsed.events.map((ev) => eventToRow(ev, receivedAt));
      appendRows(CONVERSATION_LOG, rows);
    }
    return textResponse('ok');
  } catch (err) {
    logOps('ERROR', 'doPost', '', String((err && err.stack) || err));
    return textResponse('error');
  }
}

/** ブラウザで URL を開いたときの生存確認。 */
function doGet() {
  return textResponse('line-autoreply webhook is alive');
}

/**
 * @param {string} text
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function textResponse(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * GAS の doPost はリクエストヘッダを受け取れない (2025 年時点)。
 * 将来 e.headers が提供された場合に備えて拾うだけにしておく。
 * @param {any} e
 * @returns {string | null}
 */
function getSignatureHeader(e) {
  const headers = e && e.headers;
  if (!headers || typeof headers !== 'object') return null;
  const value = headers['X-Line-Signature'] || headers['x-line-signature'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * @param {string} value
 * @param {string} key
 * @returns {string}
 */
function hmacSha256Base64(value, key) {
  const bytes = Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

// ---------- 初期セットアップ ----------

/**
 * シート 4 枚を見出し付きで作る。既存シートは壊さず、見出し行だけ上書きする。
 * スプレッドシートに紐づいた Apps Script から手動で 1 回実行する。
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ALL_SHEETS.forEach((def) => {
    let sheet = ss.getSheetByName(def.name);
    const created = !sheet;
    if (!sheet) sheet = ss.insertSheet(def.name);
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers.slice()]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (created && def.initialRows && def.initialRows.length > 0) {
      const rows = def.initialRows.map((r) => r.slice());
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }
  });
  const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > ALL_SHEETS.length) {
    ss.deleteSheet(defaultSheet);
  }
  logOps('INFO', 'setup', '', 'シートを初期化しました');
}

/**
 * Webhook URL に付ける秘密トークンを生成してスクリプトプロパティに保存する。
 * 既にあれば作り直さない。値は実行ログに出るので Webhook URL に `?token=<値>` として付ける。
 */
function generateWebhookToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(PROP.WEBHOOK_TOKEN);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(PROP.WEBHOOK_TOKEN, token);
  }
  Logger.log('WEBHOOK_TOKEN=%s\nWebhook URL の末尾に ?token=%s を付けてください', token, token);
}

/** スクリプトプロパティの設定漏れを実行ログに出す (値は出さない)。 */
function checkConfig() {
  const props = PropertiesService.getScriptProperties();
  const required = [PROP.CHANNEL_SECRET, PROP.CHANNEL_ACCESS_TOKEN, PROP.ADMIN_USER_ID, PROP.WEBHOOK_TOKEN];
  const optional = [PROP.BOT_USER_ID];
  required.forEach((k) => Logger.log('%s: %s', k, props.getProperty(k) ? '設定済' : '未設定 (必須)'));
  optional.forEach((k) => Logger.log('%s: %s', k, props.getProperty(k) ? '設定済' : '未設定 (任意)'));
  ALL_SHEETS.forEach((def) => {
    const exists = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
    Logger.log('シート「%s」: %s', def.name, exists ? 'あり' : 'なし (setup を実行)');
  });
}

// ---------- 1 分トリガー ----------

/** 1 分ごとの時間トリガーを (重複なく) 登録する。 */
function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger(QUEUE_HANDLER_NAME).timeBased().everyMinutes(1).create();
  logOps('INFO', 'installTrigger', '', `${QUEUE_HANDLER_NAME} の 1 分トリガーを登録しました`);
}

/** このスクリプトが持つ処理関数のトリガーを全部消す。 */
function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === QUEUE_HANDLER_NAME)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * 未処理行を順に処理する骨組み。第 1 歩では状態を「処理済」に変えるだけ。
 * 後の段階でここに台帳照合 → Claude 呼び出し → 返信/承認待ちを足す。
 */
function processQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    logOps('WARN', 'processQueue', '', 'ロック取得失敗 (前回の処理が継続中)');
    return;
  }
  try {
    const sheet = getSheet(CONVERSATION_LOG);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const statusCol = columnIndex(CONVERSATION_LOG, '状態');
    const processedAtCol = columnIndex(CONVERSATION_LOG, '処理日時');
    const memoCol = columnIndex(CONVERSATION_LOG, '処理メモ');
    const width = CONVERSATION_LOG.headers.length;

    const rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    const targets = findPendingRowIndexes(rows, statusCol, PROCESS_BATCH_SIZE);
    if (targets.length === 0) return;

    const settings = parseSettings(getSheet(SETTINGS).getDataRange().getValues().slice(1));
    const resolved = resolveMode(settings);
    if (resolved.warning) logOps('WARN', 'processQueue', '', resolved.warning);

    const now = formatJst(new Date());
    targets.forEach((i) => {
      const rowNumber = i + 2;
      sheet.getRange(rowNumber, statusCol + 1).setValue(STATUS.DONE);
      sheet.getRange(rowNumber, processedAtCol + 1).setValue(now);
      sheet.getRange(rowNumber, memoCol + 1).setValue(`骨組み: mode=${resolved.mode} (返信は未実装)`);
    });
    logOps('INFO', 'processQueue', '', `${targets.length} 件を処理済にしました`);
  } catch (err) {
    logOps('ERROR', 'processQueue', '', String((err && err.stack) || err));
  } finally {
    lock.releaseLock();
  }
}

// ---------- シート入出力 ----------

/**
 * @param {{ name: string }} def
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(def) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
  if (!sheet) throw new Error(`シート「${def.name}」がありません。setup() を先に実行してください`);
  return sheet;
}

/**
 * 複数行をまとめて末尾に追記する。同時受信に備えてロックする。
 * @param {{ name: string, headers: readonly string[] }} def
 * @param {(string | number | boolean)[][]} rows
 */
function appendRows(def, rows) {
  if (rows.length === 0) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10 * 1000);
  try {
    const sheet = getSheet(def);
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, rows.length, def.headers.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 稼働ログへ 1 行書く。ログ書き込み自体の失敗で本処理を止めない。
 * @param {'INFO' | 'WARN' | 'ERROR'} level
 * @param {string} action
 * @param {string} groupId
 * @param {string} detail
 */
function logOps(level, action, groupId, detail) {
  try {
    const sheet = getSheet(OPS_LOG);
    sheet.appendRow([formatJst(new Date()), level, action, groupId, sanitizeCell(detail)]);
  } catch (err) {
    Logger.log('[%s] %s %s %s (稼働ログ書き込み失敗: %s)', level, action, groupId, detail, err);
  }
}
