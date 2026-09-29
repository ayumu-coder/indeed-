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
