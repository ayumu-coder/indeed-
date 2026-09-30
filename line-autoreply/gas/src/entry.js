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
  /** 返信案担当が返信案ファイルを置く Google Drive フォルダの ID */
  DRAFT_FOLDER_ID: 'DRAFT_FOLDER_ID',
});

/** 1 分トリガー 1 回あたりに処理する最大件数 */
const PROCESS_BATCH_SIZE = 50;

/** 1 分トリガーが呼ぶ処理関数名 (会話ログの処理 / 返信案の取込) */
const TRIGGER_HANDLERS = Object.freeze(['processQueue', 'importDrafts']);

/** LINE Messaging API */
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_GROUP_URL = 'https://api.line.me/v2/bot/group';
const LINE_TEXT_MAX_CHARS = 5000;

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
 * 管理用のシート (会話ログ / 取引先台帳 / 設定 / 稼働ログ / 返信案 / 取込済) を見出し付きで作る。既存シートは壊さず、見出し行だけ上書きする。
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
  const required = [
    PROP.CHANNEL_SECRET,
    PROP.CHANNEL_ACCESS_TOKEN,
    PROP.ADMIN_USER_ID,
    PROP.WEBHOOK_TOKEN,
    PROP.DRAFT_FOLDER_ID,
  ];
  const optional = [PROP.BOT_USER_ID];
  required.forEach((k) => Logger.log('%s: %s', k, props.getProperty(k) ? '設定済' : '未設定 (必須)'));
  optional.forEach((k) => Logger.log('%s: %s', k, props.getProperty(k) ? '設定済' : '未設定 (任意)'));
  const folderId = props.getProperty(PROP.DRAFT_FOLDER_ID);
  if (folderId) {
    try {
      const folder = DriveApp.getFolderById(folderId);
      Logger.log('返信案フォルダ: アクセス可 (%s)', folder.getName());
    } catch (err) {
      Logger.log('返信案フォルダ: アクセス不可 (%s)', err);
    }
  }
  ALL_SHEETS.forEach((def) => {
    const exists = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
    Logger.log('シート「%s」: %s', def.name, exists ? 'あり' : 'なし (setup を実行)');
  });
}

// ---------- 1 分トリガー ----------

/** processQueue と importDrafts の 1 分ごとの時間トリガーを (重複なく) 登録する。 */
function installTrigger() {
  removeTriggers();
  TRIGGER_HANDLERS.forEach((name) => {
    ScriptApp.newTrigger(name).timeBased().everyMinutes(1).create();
  });
  logOps('INFO', 'installTrigger', '', `${TRIGGER_HANDLERS.join(' / ')} の 1 分トリガーを登録しました`);
}

/** このスクリプトが持つ処理関数のトリガーを全部消す。 */
function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * 未処理行を順に振り分ける。
 * - グループ発: 台帳で 区分=取引先 かつ 有効=TRUE のテキストだけ「返信案待ち」。社内/未登録/無効は「処理済 (対象外)」。
 * - グループ発の join で台帳に無ければ、グループ名を取得して台帳へ自動登録する (第 3 歩)。
 * - グループ発の message は送信者名を取得して「送信者名」列に書く (第 3 歩)。振り分け結果には影響しない。
 * - 1 対 1: 管理者からのテキストは承認コマンド (OK n / 却下 n) として処理。それ以外は「処理済 (対象外)」。
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
    const senderCol = columnIndex(CONVERSATION_LOG, '送信者名');
    const width = CONVERSATION_LOG.headers.length;

    const rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    const targets = findPendingRowIndexes(rows, statusCol, PROCESS_BATCH_SIZE);
    if (targets.length === 0) return;

    const ledger = readLedger();
    const exclude = resolveAutoRegisterExclude(readSettings());
    const adminUserId = PropertiesService.getScriptProperties().getProperty(PROP.ADMIN_USER_ID);
    const counts = { skip: 0, await_draft: 0, admin_command: 0, registered: 0 };

    targets.forEach((i) => {
      const rowNumber = i + 2;
      const info = rowToEventInfo(rows[i]);
      let status = STATUS.DONE;
      let memo = '';
      try {
        if (shouldAutoRegisterOnJoin(info, ledger, exclude)) {
          // 台帳に入れてから振り分けるので、同じバッチ内の後続メッセージは「返信案待ち」になる。
          const entry = registerGroup(info.groupId, ledger, 'processQueue');
          counts.registered += 1;
          counts.skip += 1;
          memo = `自動登録: ${entry.groupName || '(グループ名を取得できず)'}`;
        } else {
          const triage = triageEvent(info, ledger, adminUserId);
          counts[triage.kind] += 1;
          if (triage.kind === 'await_draft') {
            status = STATUS.WAITING_DRAFT;
            memo = `返信案待ち: ${triage.entry.company}`;
          } else if (triage.kind === 'admin_command') {
            memo = handleAdminCommand(triage.text, ledger);
          } else {
            memo = triage.memo;
          }
        }
        if (needsSenderName(info)) {
          const senderName = fetchSenderName(info.groupId, info.userId);
          if (senderName !== '') sheet.getRange(rowNumber, senderCol + 1).setValue(sanitizeCell(senderName));
        }
      } catch (err) {
        status = STATUS.ERROR;
        memo = `処理失敗: ${String((err && err.message) || err)}`;
        logOps('ERROR', 'processQueue', info.groupId, String((err && err.stack) || err));
      }
      sheet.getRange(rowNumber, statusCol + 1).setValue(status);
      sheet.getRange(rowNumber, processedAtCol + 1).setValue(formatJst(new Date()));
      sheet.getRange(rowNumber, memoCol + 1).setValue(sanitizeCell(memo));
    });
    logOps(
      'INFO',
      'processQueue',
      '',
      `${targets.length} 件を振り分け (返信案待ち ${counts.await_draft} / 承認コマンド ${counts.admin_command} / 対象外 ${counts.skip} / 自動登録 ${counts.registered})`,
    );
  } catch (err) {
    logOps('ERROR', 'processQueue', '', String((err && err.stack) || err));
  } finally {
    lock.releaseLock();
  }
}

// ---------- 取引先台帳への自動登録 (第 3 歩) ----------

/**
 * 会話ログにあって台帳に無いグループを、グループ名を取得して台帳へ一括登録する。手動で実行する。
 * 最後のイベントが leave のグループと、除外リスト (全体連絡用など) のグループは登録しない。
 * 既存の台帳行は書き換えない。
 */
function registerUnregisteredGroups() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    logOps('WARN', 'registerUnregisteredGroups', '', 'ロック取得失敗 (前回の処理が継続中)');
    return;
  }
  try {
    const sheet = getSheet(CONVERSATION_LOG);
    const lastRow = sheet.getLastRow();
    const rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, CONVERSATION_LOG.headers.length).getValues();
    const ledger = readLedger();
    const exclude = resolveAutoRegisterExclude(readSettings());
    const groupIds = findUnregisteredGroupIds(rows, ledger, exclude);
    if (groupIds.length === 0) {
      logOps('INFO', 'registerUnregisteredGroups', '', '未登録のグループはありません');
      Logger.log('未登録のグループはありません');
      return;
    }
    let done = 0;
    groupIds.forEach((groupId) => {
      try {
        registerGroup(groupId, ledger, 'registerUnregisteredGroups');
        done += 1;
      } catch (err) {
        logOps('ERROR', 'registerUnregisteredGroups', groupId, String((err && err.stack) || err));
      }
    });
    logOps('INFO', 'registerUnregisteredGroups', '', `${groupIds.length} 件中 ${done} 件を台帳へ登録しました`);
    Logger.log('%s 件中 %s 件を台帳へ登録しました。取引先台帳と稼働ログを確認してください', groupIds.length, done);
  } catch (err) {
    logOps('ERROR', 'registerUnregisteredGroups', '', String((err && err.stack) || err));
  } finally {
    lock.releaseLock();
  }
}

/**
 * グループ名を Messaging API で取得し、取引先台帳へ 1 行追記して ledger にも反映する。
 * 呼び出し側で台帳に無いことを確認済みでも、追記直前にもう一度シートを読んで二重登録を防ぐ。
 * API に失敗しても会社名を空で登録し、稼働ログに WARN を残す。
 * @param {string} groupId
 * @param {Map<string, LedgerEntry>} ledger 呼び出し側が保持する台帳 (登録後に更新される)
 * @param {string} action 稼働ログの「処理」列
 * @returns {LedgerEntry}
 */
function registerGroup(groupId, ledger, action) {
  const existing = readLedger().get(groupId);
  if (existing) {
    ledger.set(groupId, existing);
    logOps('INFO', action, groupId, '台帳に登録済みのため自動登録をスキップ');
    return existing;
  }
  const summary = fetchGroupSummary(groupId);
  if (summary.warning) logOps('WARN', action, groupId, `グループ名を取得できず会社名を空で登録: ${summary.warning}`);
  const row = buildAutoLedgerRow({ groupId, groupName: summary.name, registeredAt: new Date() }).map(sanitizeCell);
  getSheet(LEDGER).appendRow(row);
  const entry = parseLedger([row]).get(groupId);
  ledger.set(groupId, entry);
  logOps('INFO', action, groupId, `台帳へ自動登録: グループ名「${entry.groupName}」`);
  return entry;
}

// ---------- LINE Messaging API (取得系) ----------

/**
 * Messaging API に GET し、JSON を返す。トークンは Script Properties から読み、ログには出さない。
 * @param {string} url
 * @returns {{ ok: boolean, json: unknown, detail: string }}
 */
function lineApiGet(url) {
  const token = PropertiesService.getScriptProperties().getProperty(PROP.CHANNEL_ACCESS_TOKEN);
  if (!token) return { ok: false, json: null, detail: `${PROP.CHANNEL_ACCESS_TOKEN} が未設定` };
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code < 200 || code >= 300) return { ok: false, json: null, detail: `HTTP ${code} ${truncateText(text, 300)}` };
    try {
      return { ok: true, json: JSON.parse(text), detail: `HTTP ${code}` };
    } catch (err) {
      return { ok: false, json: null, detail: `応答が JSON ではない (HTTP ${code})` };
    }
  } catch (err) {
    return { ok: false, json: null, detail: `通信エラー: ${String((err && err.message) || err)}` };
  }
}

/**
 * グループ名を取得する。失敗しても例外にせず、warning に理由を入れる。
 * @param {string} groupId
 * @returns {{ name: string, warning: string | null }}
 */
function fetchGroupSummary(groupId) {
  const res = lineApiGet(`${LINE_GROUP_URL}/${encodeURIComponent(groupId)}/summary`);
  if (!res.ok) return { name: '', warning: res.detail };
  const name = pickName(res.json, 'groupName');
  return { name, warning: name === '' ? '応答に groupName がありません' : null };
}

/**
 * グループ内の送信者の表示名を取得する。(groupId, userId) ごとに CacheService で 6 時間キャッシュし、
 * 失敗は 10 分だけ覚えて連続呼び出しを抑える。取れなければ空文字。
 * @param {string} groupId
 * @param {string} userId
 * @returns {string}
 */
function fetchSenderName(groupId, userId) {
  const cache = CacheService.getScriptCache();
  const key = senderCacheKey(groupId, userId);
  const cached = cache.get(key);
  if (cached !== null) {
    try {
      const value = JSON.parse(cached);
      if (typeof value === 'string') return value;
    } catch (err) {
      // 壊れたキャッシュは無視して取り直す
    }
  }

  const res = lineApiGet(`${LINE_GROUP_URL}/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`);
  const name = res.ok ? pickName(res.json, 'displayName') : '';
  if (name === '') {
    logOps('WARN', 'senderName', groupId, `送信者名を取得できず: ${res.ok ? '応答に displayName がありません' : res.detail}`);
  }
  // 空文字も値として保存できるよう JSON 文字列で入れる。
  cache.put(key, JSON.stringify(name), name === '' ? SENDER_NAME_FAILURE_CACHE_SECONDS : SENDER_NAME_CACHE_SECONDS);
  return name;
}

// ---------- 承認コマンド (管理者 1 対 1) ----------

/**
 * 管理者からの 1 対 1 テキストを処理し、会話ログの処理メモに書く文字列を返す。
 * @param {string} text
 * @param {Map<string, LedgerEntry>} ledger
 * @returns {string}
 */
function handleAdminCommand(text, ledger) {
  const cmd = parseApprovalCommand(text);
  if (!cmd) return '管理者メッセージ (承認コマンドではない)';

  const drafts = readDraftRecords();
  const record = findDraftByNumber(drafts.records, cmd.number);
  const label = cmd.action === 'approve' ? 'OK' : '却下';

  if (!record || record.status !== DRAFT_STATUS.WAITING_APPROVAL) {
    const currentStatus = record ? record.status : null;
    notifyAdmin(buildNoMatchText(cmd, currentStatus));
    logOps('WARN', 'approval', record ? record.groupId : '', `${label} #${cmd.number}: 該当なし (状態=${currentStatus || '無し'})`);
    return `${label} #${cmd.number}: 該当なし`;
  }

  const now = formatJst(new Date());
  if (cmd.action === 'reject') {
    updateDraftCells(drafts.sheet, record.rowIndex, { 状態: DRAFT_STATUS.REJECTED, 承認日時: now });
    updateConversationByEventId(record.eventId, STATUS.DONE, `却下 #${record.number}`);
    logOps('INFO', 'approval', record.groupId, `却下 #${record.number}【${record.company}】`);
    notifyAdmin(`却下しました #${record.number}【${record.company}】`);
    return `却下 #${record.number}`;
  }

  updateDraftCells(drafts.sheet, record.rowIndex, { 承認日時: now });
  logOps('INFO', 'approval', record.groupId, `OK #${record.number}【${record.company}】`);
  const result = sendDraft(drafts.sheet, record, ledger);
  return `OK #${record.number}: ${result}`;
}

// ---------- 返信案の取込 (1 分トリガー) ----------

/**
 * 返信案の供給元 (差し替え可能な 1 か所)。
 * 今は Google Drive のフォルダから「LINE返信案_YYYYMMDD-HHMM」のスプレッドシート / CSV を読む。
 * 後日 API 方式に切り替えるときは、この関数だけを差し替えて同じ形の配列を返せばよい。
 * @param {Set<string>} importedIds 取込済のファイル ID
 * @returns {{ id: string, name: string, values: unknown[][] }[]} 1 要素 = 1 ファイル。values は見出し行を含む全セル
 */
function collectDraftBatches(importedIds) {
  const folderId = PropertiesService.getScriptProperties().getProperty(PROP.DRAFT_FOLDER_ID);
  if (!folderId) {
    logOps('WARN', 'importDrafts', '', `スクリプトプロパティ ${PROP.DRAFT_FOLDER_ID} が未設定`);
    return [];
  }
  const files = DriveApp.getFolderById(folderId).getFiles();
  const candidates = [];
  while (files.hasNext()) {
    const file = files.next();
    const id = file.getId();
    const name = file.getName();
    if (importedIds.has(id) || !isDraftFileName(name)) continue;
    const mime = file.getMimeType();
    if (mime !== MimeType.GOOGLE_SHEETS && mime !== MimeType.CSV) continue;
    candidates.push({ id, name, mime, file });
  }
  candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    values:
      c.mime === MimeType.GOOGLE_SHEETS
        ? SpreadsheetApp.openById(c.id).getSheets()[0].getDataRange().getValues()
        : Utilities.parseCsv(c.file.getBlob().getDataAsString('UTF-8')),
  }));
}

/**
 * 返信案フォルダの未取込ファイルを「返信案」タブへ取り込み、管理者へ承認依頼 (mode=auto なら安全確認の上で送信) する。
 */
function importDrafts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    logOps('WARN', 'importDrafts', '', 'ロック取得失敗 (前回の処理が継続中)');
    return;
  }
  try {
    const importedIds = readImportedIds();
    const batches = collectDraftBatches(importedIds);
    if (batches.length === 0) return;

    const resolved = resolveMode(readSettings());
    if (resolved.warning) logOps('WARN', 'importDrafts', '', resolved.warning);
    const ledger = readLedger();

    batches.forEach((batch) => {
      try {
        importBatch(batch, resolved.mode, ledger);
      } catch (err) {
        logOps('ERROR', 'importDrafts', '', `${batch.name}: ${String((err && err.stack) || err)}`);
      }
    });
  } catch (err) {
    logOps('ERROR', 'importDrafts', '', String((err && err.stack) || err));
  } finally {
    lock.releaseLock();
  }
}

/**
 * 1 ファイル分を取り込む。
 * @param {{ id: string, name: string, values: unknown[][] }} batch
 * @param {'approval' | 'auto'} mode
 * @param {Map<string, LedgerEntry>} ledger
 */
function importBatch(batch, mode, ledger) {
  const parsed = parseDraftFile(batch.values);
  const drafts = readDraftRecords();
  const existingIds = drafts.records.map((r) => r.eventId);
  const { fresh, duplicates } = dedupeDrafts(parsed.drafts, existingIds);
  const now = formatJst(new Date());
  let number = nextDraftNumber(drafts.records);
  const senderNames = readSenderNamesByEventIds(fresh.map((d) => d.eventId));

  /** @type {{ record: DraftRecord & { sender: string }, action: string, safety: SafetyResult }[]} */
  const planned = [];
  const rows = fresh.map((draft) => {
    const safety = checkSendSafety({ text: draft.reply, groupId: draft.groupId, ledger });
    const action = decideImportAction({ verdict: draft.verdict, mode, safety });
    const status = initialDraftStatus(action);
    const row = buildDraftRow({ number, draft, status, createdAt: now, source: batch.name });
    planned.push({
      record: { rowIndex: drafts.records.length + planned.length, number, eventId: draft.eventId, groupId: draft.groupId, company: draft.company, received: draft.received, reply: draft.reply, verdict: draft.verdict, reason: draft.reason, status, sender: senderNames.get(draft.eventId) || '' },
      action,
      safety,
    });
    number += 1;
    return row.map(sanitizeCell);
  });

  // 先に「返信案」と「取込済」へ書き、二重取込を防いでから通知・送信する。
  if (rows.length > 0) {
    const start = drafts.sheet.getLastRow() + 1;
    drafts.sheet.getRange(start, 1, rows.length, DRAFTS.headers.length).setValues(rows);
    // 行位置を実際の追記位置に合わせる (返信案タブに番号なし行が混ざっていた場合のずれを吸収)。
    planned.forEach((p, i) => {
      p.record.rowIndex = start - 2 + i;
    });
  }
  const note = parsed.errors.length > 0 ? `不備 ${parsed.errors.length} 件: ${parsed.errors.join(' / ')}` : '';
  getSheet(IMPORTED).appendRow([batch.id, batch.name, now, rows.length, duplicates.length, sanitizeCell(note)]);
  logOps(
    'INFO',
    'importDrafts',
    '',
    `${batch.name}: 取込 ${rows.length} 件 / 重複 ${duplicates.length} 件 / 不備 ${parsed.errors.length} 件 (mode=${mode})`,
  );
  if (parsed.errors.length > 0) logOps('WARN', 'importDrafts', '', `${batch.name}: ${note}`);

  planned.forEach((p) => {
    const r = p.record;
    if (p.action === 'human') {
      updateConversationByEventId(r.eventId, STATUS.HUMAN, `人に回す #${r.number}`);
      notifyAdmin(buildHumanNoticeText(r));
      logOps('INFO', 'importDrafts', r.groupId, `人に回す #${r.number}【${r.company}】`);
    } else if (p.action === 'await_approval') {
      updateConversationByEventId(r.eventId, STATUS.WAITING_APPROVAL, `承認待ち #${r.number}`);
      notifyAdmin(buildApprovalRequestText(r));
      logOps('INFO', 'importDrafts', r.groupId, `承認依頼 #${r.number}【${r.company}】`);
    } else if (p.action === 'send') {
      updateConversationByEventId(r.eventId, STATUS.WAITING_APPROVAL, `自動送信 #${r.number}`);
      sendDraft(drafts.sheet, r, ledger);
    } else {
      // 保留は管理者が手で扱う必要があるため、会話ログ上は「人に回す」にする。
      updateConversationByEventId(r.eventId, STATUS.HUMAN, `送信保留 #${r.number}`);
      updateDraftCells(drafts.sheet, r.rowIndex, { 送信結果: `保留: ${p.safety.reasons.join(' / ')}` });
      notifyAdmin(buildHoldNoticeText(r, p.safety.reasons));
      logOps('WARN', 'send', r.groupId, `送信保留 #${r.number}: ${p.safety.reasons.join(' / ')}`);
    }
  });
}

// ---------- グループへの送信 ----------

/**
 * 返信案をグループへ送る。送信直前に必ず安全確認を行い、引っかかれば「送信保留」にして管理者へ理由を送る。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} draftSheet
 * @param {DraftRecord} record
 * @param {Map<string, LedgerEntry>} ledger
 * @returns {string} 処理結果の短い説明
 */
function sendDraft(draftSheet, record, ledger) {
  const safety = checkSendSafety({ text: record.reply, groupId: record.groupId, ledger });
  if (!safety.ok) {
    const reason = safety.reasons.join(' / ');
    updateDraftCells(draftSheet, record.rowIndex, { 状態: DRAFT_STATUS.HELD, 送信結果: `保留: ${reason}` });
    updateConversationByEventId(record.eventId, STATUS.HUMAN, `送信保留 #${record.number}`);
    notifyAdmin(buildHoldNoticeText(record, safety.reasons));
    logOps('WARN', 'send', record.groupId, `送信保留 #${record.number}: ${reason}`);
    return `送信保留 (${reason})`;
  }

  const res = pushText(record.groupId, record.reply);
  if (res.ok) {
    updateDraftCells(draftSheet, record.rowIndex, { 状態: DRAFT_STATUS.SENT, 送信結果: res.detail });
    updateConversationByEventId(record.eventId, STATUS.REPLIED, `返信済 #${record.number}`);
    logOps('INFO', 'send', record.groupId, `送信済 #${record.number}【${record.company}】`);
    notifyAdmin(`送信しました #${record.number}【${record.company}】`);
    return '送信済';
  }
  updateDraftCells(draftSheet, record.rowIndex, { 状態: DRAFT_STATUS.SEND_FAILED, 送信結果: res.detail });
  updateConversationByEventId(record.eventId, STATUS.ERROR, `送信失敗 #${record.number}`);
  logOps('ERROR', 'send', record.groupId, `送信失敗 #${record.number}: ${res.detail}`);
  notifyAdmin(`送信失敗 #${record.number}【${record.company}】\n${res.detail}`);
  return `送信失敗 (${res.detail})`;
}

/**
 * Messaging API の push でテキストを 1 通送る。トークンはログに出さない。
 * @param {string} to ユーザー ID またはグループ ID
 * @param {string} text
 * @returns {{ ok: boolean, detail: string }}
 */
function pushText(to, text) {
  const token = PropertiesService.getScriptProperties().getProperty(PROP.CHANNEL_ACCESS_TOKEN);
  if (!token) return { ok: false, detail: `${PROP.CHANNEL_ACCESS_TOKEN} が未設定` };
  if (!to) return { ok: false, detail: '送信先が空' };
  try {
    const res = UrlFetchApp.fetch(LINE_PUSH_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${token}`, 'X-Line-Retry-Key': Utilities.getUuid() },
      payload: JSON.stringify({ to, messages: [{ type: 'text', text: truncateText(text, LINE_TEXT_MAX_CHARS) }] }),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true, detail: `HTTP ${code}` };
    return { ok: false, detail: `HTTP ${code} ${truncateText(res.getContentText(), 300)}` };
  } catch (err) {
    return { ok: false, detail: `通信エラー: ${String((err && err.message) || err)}` };
  }
}

/**
 * 管理者へ 1 対 1 で通知する。失敗しても本処理は止めず稼働ログに残す。
 * @param {string} text
 */
function notifyAdmin(text) {
  const adminId = PropertiesService.getScriptProperties().getProperty(PROP.ADMIN_USER_ID);
  if (!adminId) {
    logOps('WARN', 'notifyAdmin', '', `${PROP.ADMIN_USER_ID} が未設定のため通知できません`);
    return;
  }
  const res = pushText(adminId, text);
  if (!res.ok) logOps('ERROR', 'notifyAdmin', '', `管理者への通知失敗: ${res.detail}`);
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

/** 「取引先台帳」を読む。 */
function readLedger() {
  return parseLedger(getSheet(LEDGER).getDataRange().getValues().slice(1));
}

/** 「設定」を読む。 */
function readSettings() {
  return parseSettings(getSheet(SETTINGS).getDataRange().getValues().slice(1));
}

/**
 * 会話ログから webhookEventId → 送信者名 を引く (同じ ID が複数あれば最後の行)。
 * @param {readonly string[]} eventIds
 * @returns {Map<string, string>}
 */
function readSenderNamesByEventIds(eventIds) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (eventIds.length === 0) return out;
  const sheet = getSheet(CONVERSATION_LOG);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  const wanted = new Set(eventIds);
  const idCol = columnIndex(CONVERSATION_LOG, 'webhookEventId');
  const senderCol = columnIndex(CONVERSATION_LOG, '送信者名');
  const rows = sheet.getRange(2, 1, lastRow - 1, CONVERSATION_LOG.headers.length).getValues();
  rows.forEach((row) => {
    const id = String(row[idCol] ?? '');
    if (wanted.has(id)) out.set(id, String(row[senderCol] ?? '').trim());
  });
  return out;
}

/** 「取込済」のファイル ID を読む。 */
function readImportedIds() {
  const sheet = getSheet(IMPORTED);
  const col = columnIndex(IMPORTED, 'ファイルID');
  return new Set(
    sheet
      .getDataRange()
      .getValues()
      .slice(1)
      .map((row) => String(row[col] || '').trim())
      .filter((id) => id !== ''),
  );
}

/**
 * 「返信案」タブを読む。
 * @returns {{ sheet: GoogleAppsScript.Spreadsheet.Sheet, records: DraftRecord[] }}
 */
function readDraftRecords() {
  const sheet = getSheet(DRAFTS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, DRAFTS.headers.length).getValues();
  return { sheet, records: parseDraftRecords(rows) };
}

/**
 * 「返信案」タブの 1 行の一部の列を更新する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowIndex 見出しを除いた 0 始まりの添字
 * @param {Record<string, string>} values 見出し名 → 値
 */
function updateDraftCells(sheet, rowIndex, values) {
  Object.keys(values).forEach((header) => {
    sheet.getRange(rowIndex + 2, columnIndex(DRAFTS, header) + 1).setValue(sanitizeCell(values[header]));
  });
}

/**
 * 会話ログで webhookEventId が一致する行 (複数あれば最後) の状態・処理日時・処理メモを更新する。
 * 見つからなければ何もしない (取込ファイルの ID が誤っている場合など)。
 * @param {string} eventId
 * @param {string} status
 * @param {string} memo
 */
function updateConversationByEventId(eventId, status, memo) {
  if (!eventId) return;
  const sheet = getSheet(CONVERSATION_LOG);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const idCol = columnIndex(CONVERSATION_LOG, 'webhookEventId');
  const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  let found = -1;
  for (let i = 0; i < ids.length; i += 1) {
    if (String(ids[i][0]) === eventId) found = i;
  }
  if (found < 0) {
    logOps('WARN', 'updateConversation', '', `webhookEventId=${eventId} の行が会話ログにありません`);
    return;
  }
  const rowNumber = found + 2;
  sheet.getRange(rowNumber, columnIndex(CONVERSATION_LOG, '状態') + 1).setValue(status);
  sheet.getRange(rowNumber, columnIndex(CONVERSATION_LOG, '処理日時') + 1).setValue(formatJst(new Date()));
  sheet.getRange(rowNumber, columnIndex(CONVERSATION_LOG, '処理メモ') + 1).setValue(sanitizeCell(memo));
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
