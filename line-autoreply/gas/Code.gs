// このファイルは自動生成です。直接編集せず lib/*.js と gas/src/entry.js を編集し、
// line-autoreply/ で `npm run build` を実行してください。
// Apps Script エディタにはこのファイルの全文をそのまま貼り付けます。

// ===== lib/approval.js =====
// 管理者の承認コマンド解釈、送信前の安全確認、管理者向け本文の組み立て (純粋関数)。


/**
 * 全角英数・全角空白・記号の揺れを NFKC で吸収し、空白を 1 つにまとめる。
 * @param {unknown} text
 * @returns {string}
 */
function normalizeCommandText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @typedef {object} ApprovalCommand
 * @property {'approve' | 'reject'} action
 * @property {number} number 返信案の番号
 */

/**
 * 「OK 12」「却下 12」「ＯＫ　１２」「ok#12」などを解釈する。該当しなければ null。
 * @param {unknown} text
 * @returns {ApprovalCommand | null}
 */
function parseApprovalCommand(text) {
  const normalized = normalizeCommandText(text);
  const m = /^(ok|却下)\s*#?\s*(\d{1,9})$/i.exec(normalized);
  if (!m) return null;
  return {
    action: m[1].toLowerCase() === 'ok' ? 'approve' : 'reject',
    number: Number(m[2]),
  };
}

/** 返信案に含まれてはいけない金額表現 */
const MONEY_MARKERS = Object.freeze(['万円', '円', '¥', '￥']);

/**
 * @typedef {object} SafetyResult
 * @property {boolean} ok
 * @property {string[]} reasons 引っかかった理由 (ok なら空)
 */

/**
 * グループへ送る直前の安全確認。1 つでも引っかかれば送らない。
 * - 本文に金額表現 (円 / ¥ / 万円) が無い
 * - 取引先台帳の「他社」(区分=取引先 で会社名が送信先と異なる) の会社名を含まない
 * - 送信先が台帳に登録され、区分=取引先 かつ 有効=TRUE である
 * @param {{ text: string, groupId: string, ledger: Map<string, import('./ledger.js').LedgerEntry> }} input
 * @returns {SafetyResult}
 */
function checkSendSafety(input) {
  const text = String(input.text ?? '');
  const reasons = [];

  if (text.trim() === '') reasons.push('返信案が空');

  for (const marker of MONEY_MARKERS) {
    if (text.includes(marker)) {
      reasons.push(`金額表現「${marker}」を含む`);
      break;
    }
  }

  const target = input.ledger.get(input.groupId);
  if (!target) {
    reasons.push('送信先グループが台帳に未登録');
  } else if (target.kind !== LEDGER_KIND.CLIENT) {
    reasons.push(`送信先の区分が取引先ではない (${target.kind || '空'})`);
  } else if (!target.enabled) {
    reasons.push('送信先グループが無効');
  }

  const targetCompany = target ? target.company : '';
  const seen = new Set();
  for (const entry of input.ledger.values()) {
    if (entry.kind !== LEDGER_KIND.CLIENT) continue;
    if (entry.company === '' || entry.company === targetCompany) continue;
    if (seen.has(entry.company)) continue;
    seen.add(entry.company);
    if (text.includes(entry.company)) reasons.push(`他社名「${entry.company}」を含む`);
  }

  return { ok: reasons.length === 0, reasons };
}

/** 承認依頼に載せる受信本文の上限 */
const RECEIVED_PREVIEW_CHARS = 100;

/**
 * @param {unknown} text
 * @param {number} max
 * @returns {string}
 */
function truncateText(text, max) {
  const s = String(text ?? '');
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max).join('')}…`;
}

/**
 * @typedef {object} DraftSummary
 * @property {number} number
 * @property {string} company
 * @property {string} received 受信本文
 * @property {string} reply    返信案
 * @property {string} reason   判定理由
 * @property {string} [sender] 受信メッセージの送信者名 (会話ログの「送信者名」。無ければ空)
 */

/**
 * 「受信: …」の行。送信者名が分かっていれば「受信 (送信者名): …」にする。
 * @param {DraftSummary} d
 * @returns {string}
 */
function buildReceivedLine(d) {
  const sender = String(d.sender ?? '').trim();
  const label = sender === '' ? '受信' : `受信 (${sender})`;
  return `${label}: ${truncateText(d.received, RECEIVED_PREVIEW_CHARS)}`;
}

/**
 * 承認依頼 (判定=返信) の本文。
 * @param {DraftSummary} d
 * @returns {string}
 */
function buildApprovalRequestText(d) {
  return [
    `案 #${d.number}【${d.company}】`,
    buildReceivedLine(d),
    `返信案: ${d.reply}`,
    `→ 送るなら『OK ${d.number}』、送らないなら『却下 ${d.number}』`,
  ].join('\n');
}

/**
 * 人に回す (判定=人に回す) の通知本文。OK/却下 は受け付けない。
 * @param {DraftSummary} d
 * @returns {string}
 */
function buildHumanNoticeText(d) {
  return [`人に回す #${d.number}【${d.company}】`, buildReceivedLine(d), `理由: ${d.reason}`].join('\n');
}

/**
 * 安全確認で送信を保留したときの通知本文。
 * @param {DraftSummary} d
 * @param {readonly string[]} reasons
 * @returns {string}
 */
function buildHoldNoticeText(d, reasons) {
  return [`送信保留 #${d.number}【${d.company}】`, `理由: ${reasons.join(' / ')}`, '返信案は「返信案」タブで確認してください'].join('\n');
}

/**
 * 番号が無い・状態が違うときの返答。
 * @param {ApprovalCommand} cmd
 * @param {string | null} currentStatus 見つかった案の状態。無ければ null
 * @returns {string}
 */
function buildNoMatchText(cmd, currentStatus) {
  const label = cmd.action === 'approve' ? 'OK' : '却下';
  if (currentStatus === null) return `該当なし: #${cmd.number} の返信案はありません (${label})`;
  return `該当なし: #${cmd.number} は「${currentStatus}」のため ${label} できません`;
}

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

// ===== lib/drafts.js =====
// 返信案ファイルの解釈、重複排除、取込時の扱いの決定、「返信案」タブの行変換 (純粋関数)。


/**
 * 返信案担当が作るファイル名か (「LINE返信案_YYYYMMDD-HHMM」で始まる)。
 * @param {unknown} name
 * @returns {boolean}
 */
function isDraftFileName(name) {
  return typeof name === 'string' && DRAFT_FILE_NAME_PATTERN.test(name.trim());
}

/**
 * @typedef {object} DraftInput 返信案ファイルの 1 行
 * @property {string} eventId   webhookEventId
 * @property {string} groupId
 * @property {string} company
 * @property {string} received  受信本文
 * @property {string} reply     返信案
 * @property {'返信' | '人に回す'} verdict
 * @property {string} reason
 */

/**
 * @typedef {object} ParsedDraftFile
 * @property {DraftInput[]} drafts
 * @property {string[]} errors 行単位の不備。ファイル全体が読めないときは drafts が空で errors に理由
 */

/**
 * 返信案ファイルの全セル (1 行目は見出し) を解釈する。列は見出し名で引くので順序は問わない。
 * @param {readonly (readonly unknown[])[]} values
 * @returns {ParsedDraftFile}
 */
function parseDraftFile(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { drafts: [], errors: ['ファイルが空'] };
  }
  const header = values[0].map((h) => String(h ?? '').trim());
  const index = {};
  for (const name of DRAFT_FILE_HEADERS) {
    const i = header.indexOf(name);
    if (i < 0) return { drafts: [], errors: [`見出し「${name}」がありません (1 行目: ${header.join(', ')})`] };
    index[name] = i;
  }
  const cell = (row, name) => String(row?.[index[name]] ?? '').trim();

  /** @type {DraftInput[]} */
  const drafts = [];
  /** @type {string[]} */
  const errors = [];
  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    const isBlank = !row || row.every((v) => String(v ?? '').trim() === '');
    if (isBlank) continue;
    const line = r + 1;
    const eventId = cell(row, 'webhookEventId');
    const groupId = cell(row, 'グループID');
    const verdict = cell(row, '判定');
    const reply = cell(row, '返信案');
    if (eventId === '') {
      errors.push(`${line} 行目: webhookEventId が空`);
      continue;
    }
    if (groupId === '') {
      errors.push(`${line} 行目: グループID が空`);
      continue;
    }
    if (verdict !== VERDICT.REPLY && verdict !== VERDICT.HUMAN) {
      errors.push(`${line} 行目: 判定「${verdict}」は不正 (${VERDICT.REPLY} | ${VERDICT.HUMAN})`);
      continue;
    }
    if (verdict === VERDICT.REPLY && reply === '') {
      errors.push(`${line} 行目: 判定=返信 なのに返信案が空`);
      continue;
    }
    drafts.push({
      eventId,
      groupId,
      company: cell(row, '会社名'),
      received: cell(row, '受信本文'),
      reply,
      verdict: /** @type {'返信' | '人に回す'} */ (verdict),
      reason: cell(row, '理由'),
    });
  }
  return { drafts, errors };
}

/**
 * 既に「返信案」タブにある webhookEventId と、同一ファイル内の重複を除く。
 * @param {readonly DraftInput[]} drafts
 * @param {Iterable<string>} existingEventIds
 * @returns {{ fresh: DraftInput[], duplicates: DraftInput[] }}
 */
function dedupeDrafts(drafts, existingEventIds) {
  const seen = new Set(existingEventIds);
  const fresh = [];
  const duplicates = [];
  for (const d of drafts) {
    if (seen.has(d.eventId)) {
      duplicates.push(d);
      continue;
    }
    seen.add(d.eventId);
    fresh.push(d);
  }
  return { fresh, duplicates };
}

/**
 * @typedef {'await_approval' | 'human' | 'send' | 'hold'} ImportAction
 */

/**
 * 取込時に返信案をどう扱うか。
 * - 判定=人に回す → human (管理者へ通知のみ)
 * - mode=approval → await_approval (管理者へ承認依頼)
 * - mode=auto → 安全確認を通れば send、通らなければ hold
 * @param {{ verdict: string, mode: 'approval' | 'auto', safety: { ok: boolean } }} input
 * @returns {ImportAction}
 */
function decideImportAction(input) {
  if (input.verdict === VERDICT.HUMAN) return 'human';
  if (input.mode !== 'auto') return 'await_approval';
  return input.safety.ok ? 'send' : 'hold';
}

/**
 * ImportAction に対応する「返信案」タブの初期状態。send は送信結果で確定するため承認待ちを経ずに一旦 送信保留 とし、
 * 送信処理側が 送信済 / 送信失敗 に更新する。
 * @param {ImportAction} action
 * @returns {string}
 */
function initialDraftStatus(action) {
  switch (action) {
    case 'human':
      return DRAFT_STATUS.HUMAN;
    case 'await_approval':
      return DRAFT_STATUS.WAITING_APPROVAL;
    case 'send':
    case 'hold':
      return DRAFT_STATUS.HELD;
    default:
      throw new Error(`不明な取込アクション: ${action}`);
  }
}

/**
 * 「返信案」タブへ追記する 1 行を作る。列順は DRAFTS.headers と一致する。
 * @param {{ number: number, draft: DraftInput, status: string, createdAt: string, source: string }} input
 * @returns {(string | number)[]}
 */
function buildDraftRow(input) {
  const row = new Array(DRAFTS.headers.length).fill('');
  const set = (h, v) => {
    row[columnIndex(DRAFTS, h)] = v;
  };
  set('番号', input.number);
  set('webhookEventId', input.draft.eventId);
  set('グループID', input.draft.groupId);
  set('会社名', input.draft.company);
  set('受信本文', input.draft.received);
  set('返信案', input.draft.reply);
  set('判定', input.draft.verdict);
  set('理由', input.draft.reason);
  set('状態', input.status);
  set('作成日時', input.createdAt);
  set('取込元', input.source);
  return row;
}

/**
 * @typedef {object} DraftRecord 「返信案」タブの 1 行
 * @property {number} rowIndex  見出しを除いた 0 始まりの添字
 * @property {number} number
 * @property {string} eventId
 * @property {string} groupId
 * @property {string} company
 * @property {string} received
 * @property {string} reply
 * @property {string} verdict
 * @property {string} reason
 * @property {string} status
 */

/**
 * 「返信案」タブのデータ行 (見出し除く) を DraftRecord に変換する。番号が数値でない行は捨てる。
 * @param {readonly (readonly unknown[])[]} rows
 * @returns {DraftRecord[]}
 */
function parseDraftRecords(rows) {
  const get = (row, h) => String(row?.[columnIndex(DRAFTS, h)] ?? '').trim();
  const out = [];
  rows.forEach((row, rowIndex) => {
    const number = Number(row?.[columnIndex(DRAFTS, '番号')]);
    if (!Number.isInteger(number) || number <= 0) return;
    out.push({
      rowIndex,
      number,
      eventId: get(row, 'webhookEventId'),
      groupId: get(row, 'グループID'),
      company: get(row, '会社名'),
      received: get(row, '受信本文'),
      reply: get(row, '返信案'),
      verdict: get(row, '判定'),
      reason: get(row, '理由'),
      status: get(row, '状態'),
    });
  });
  return out;
}

/**
 * 次に採番する番号 (既存の最大 + 1、無ければ 1)。
 * @param {readonly DraftRecord[]} records
 * @returns {number}
 */
function nextDraftNumber(records) {
  let max = 0;
  for (const r of records) if (r.number > max) max = r.number;
  return max + 1;
}

/**
 * 番号で返信案を探す。同じ番号が複数あれば最後の行を返す。
 * @param {readonly DraftRecord[]} records
 * @param {number} number
 * @returns {DraftRecord | null}
 */
function findDraftByNumber(records, number) {
  let found = null;
  for (const r of records) if (r.number === number) found = r;
  return found;
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
    '', // 送信者名は processQueue が Messaging API で埋める
  ].map(sanitizeCell);

  if (row.length !== CONVERSATION_LOG.headers.length) {
    throw new Error('会話ログの列数と行の長さが一致しません');
  }
  return row;
}

// ===== lib/groups.js =====
// 取引先台帳への自動登録と、送信者名の解決に使う純粋関数 (第 3 歩)。
// Messaging API の呼び出し自体は gas/src/entry.js が行い、ここは応答の解釈と行の組み立てだけを担う。


/** 送信者名のキャッシュ有効期間 (秒)。CacheService の上限は 6 時間 */
const SENDER_NAME_CACHE_SECONDS = 6 * 60 * 60;
/** 取得失敗を短時間だけ覚えて連続呼び出しを抑える (秒) */
const SENDER_NAME_FAILURE_CACHE_SECONDS = 10 * 60;
/** 会社名・グループ名・送信者名としてシートに書く長さの上限 */
const NAME_MAX_CHARS = 200;

/**
 * 「設定」の auto_register_exclude (カンマ・空白区切り) と既定の除外 ID を合わせた集合を返す。
 * @param {Record<string, string>} settings
 * @returns {Set<string>}
 */
function resolveAutoRegisterExclude(settings) {
  const out = new Set(DEFAULT_AUTO_REGISTER_EXCLUDE);
  const raw = String(settings?.[SETTING_KEYS.AUTO_REGISTER_EXCLUDE] ?? '');
  for (const id of raw.split(/[\s,、]+/)) {
    if (id !== '') out.add(id);
  }
  return out;
}

/**
 * 備考に書く「自動登録 YYYY-MM-DD HH:mm」。
 * @param {Date} date
 * @returns {string}
 */
function formatAutoRegisterNote(date) {
  return `自動登録 ${formatJst(date).slice(0, 16)}`;
}

/**
 * Messaging API の応答 (グループ概要 / メンバープロフィール) から名前を取り出す。無ければ空文字。
 * @param {unknown} json
 * @param {'groupName' | 'displayName'} field
 * @returns {string}
 */
function pickName(json, field) {
  if (json === null || typeof json !== 'object') return '';
  const value = /** @type {Record<string, unknown>} */ (json)[field];
  if (typeof value !== 'string') return '';
  const chars = Array.from(value.trim());
  return chars.length <= NAME_MAX_CHARS ? chars.join('') : `${chars.slice(0, NAME_MAX_CHARS).join('')}…`;
}

/**
 * 送信者名キャッシュのキー (CacheService のキーは 250 文字以内)。
 * @param {string} groupId
 * @param {string} userId
 * @returns {string}
 */
function senderCacheKey(groupId, userId) {
  return `sender:${groupId}:${userId}`;
}

/**
 * 取引先台帳へ自動登録する 1 行を作る。列順は LEDGER.headers と一致する。
 * 会社名・グループ名にはグループ名 (取得失敗時は空) を入れ、区分=取引先、有効=TRUE、備考=「自動登録 日時」。
 * @param {{ groupId: string, groupName: string, registeredAt: Date }} input
 * @returns {(string | boolean)[]}
 */
function buildAutoLedgerRow(input) {
  const row = new Array(LEDGER.headers.length).fill('');
  const set = (h, v) => {
    row[columnIndex(LEDGER, h)] = v;
  };
  set('グループID', input.groupId);
  set('会社名', input.groupName);
  set('グループ名', input.groupName);
  set('区分', LEDGER_KIND.CLIENT);
  set('有効', true);
  set('備考', formatAutoRegisterNote(input.registeredAt));
  return row;
}

/**
 * join 行を自動登録すべきか (グループ発の join で、台帳に無く、除外リストにも無い)。
 * @param {import('./ledger.js').EventInfo} info
 * @param {Map<string, import('./ledger.js').LedgerEntry>} ledger
 * @param {Set<string>} exclude
 * @returns {boolean}
 */
function shouldAutoRegisterOnJoin(info, ledger, exclude) {
  return info.eventType === 'join' && info.sourceType === 'group' && info.groupId !== '' && !ledger.has(info.groupId) && !exclude.has(info.groupId);
}

/**
 * 会話ログ (見出しを除いた全データ行、古い順) から、台帳に無いグループ ID を初出順に返す。
 * 最後のイベントが leave のグループ (ボットが退出済み) と、除外リストのグループは含めない。
 * @param {readonly (readonly unknown[])[]} rows
 * @param {Map<string, import('./ledger.js').LedgerEntry>} ledger
 * @param {Set<string>} exclude
 * @returns {string[]}
 */
function findUnregisteredGroupIds(rows, ledger, exclude) {
  const typeCol = columnIndex(CONVERSATION_LOG, 'イベント種別');
  const sourceCol = columnIndex(CONVERSATION_LOG, 'ソース種別');
  const groupCol = columnIndex(CONVERSATION_LOG, 'グループID');
  /** @type {Map<string, string>} グループID → 最後のイベント種別 */
  const lastEvent = new Map();
  for (const row of rows) {
    if (String(row?.[sourceCol] ?? '').trim() !== 'group') continue;
    const groupId = String(row?.[groupCol] ?? '').trim();
    if (groupId === '') continue;
    lastEvent.set(groupId, String(row?.[typeCol] ?? '').trim());
  }
  const out = [];
  for (const [groupId, type] of lastEvent) {
    if (type === 'leave') continue;
    if (ledger.has(groupId) || exclude.has(groupId)) continue;
    out.push(groupId);
  }
  return out;
}

/**
 * 送信者名を取りに行くべき行か (グループ発の message で送信者のユーザー ID がある)。
 * @param {import('./ledger.js').EventInfo} info
 * @returns {boolean}
 */
function needsSenderName(info) {
  return info.eventType === 'message' && info.sourceType === 'group' && info.groupId !== '' && info.userId !== '';
}

// ===== lib/ledger.js =====
// 取引先台帳の解釈と、会話ログ 1 行の振り分け (純粋関数)。


/**
 * @typedef {object} LedgerEntry
 * @property {string} groupId
 * @property {string} company
 * @property {string} groupName
 * @property {string} kind        区分 (取引先 / 社内 / その他の文字列)
 * @property {string} sheetId
 * @property {string} folderId
 * @property {string} contact     担当者
 * @property {boolean} enabled    有効=TRUE
 * @property {string} note
 */

/**
 * 「有効」列の値を真偽に丸める。チェックボックス (boolean) と文字列 TRUE を受け付ける。
 * @param {unknown} value
 * @returns {boolean}
 */
function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().toUpperCase() === 'TRUE';
  return false;
}

/**
 * 「取引先台帳」のデータ行 (見出し除く) を グループID → LedgerEntry に変換する。
 * グループID が空の行は無視。同じ グループID は後勝ち。
 * @param {readonly (readonly unknown[])[]} rows
 * @returns {Map<string, LedgerEntry>}
 */
function parseLedger(rows) {
  const col = (h) => columnIndex(LEDGER, h);
  const str = (row, h) => String(row?.[col(h)] ?? '').trim();
  /** @type {Map<string, LedgerEntry>} */
  const out = new Map();
  for (const row of rows) {
    const groupId = str(row, 'グループID');
    if (groupId === '') continue;
    out.set(groupId, {
      groupId,
      company: str(row, '会社名'),
      groupName: str(row, 'グループ名'),
      kind: str(row, '区分'),
      sheetId: str(row, '共有スプレッドシートID'),
      folderId: str(row, '共有フォルダID'),
      contact: str(row, '担当者'),
      enabled: isTruthyFlag(row?.[col('有効')]),
      note: str(row, '備考'),
    });
  }
  return out;
}

/**
 * 返信を送ってよい相手か (区分=取引先 かつ 有効=TRUE)。
 * @param {LedgerEntry | undefined} entry
 * @returns {boolean}
 */
function isSendableClient(entry) {
  return !!entry && entry.kind === LEDGER_KIND.CLIENT && entry.enabled === true;
}

/**
 * @typedef {object} EventInfo
 * @property {string} eventType    message / join / ...
 * @property {string} sourceType   user / group / room
 * @property {string} groupId
 * @property {string} userId
 * @property {string} messageType  text / sticker / ...
 * @property {string} text         本文
 */

/**
 * 「会話ログ」の 1 行から振り分けに必要な値を取り出す。
 * @param {readonly unknown[]} row 見出しを除いたデータ行
 * @returns {EventInfo}
 */
function rowToEventInfo(row) {
  const get = (h) => String(row?.[columnIndex(CONVERSATION_LOG, h)] ?? '').trim();
  return {
    eventType: get('イベント種別'),
    sourceType: get('ソース種別'),
    groupId: get('グループID'),
    userId: get('ユーザーID'),
    messageType: get('メッセージ種別'),
    text: String(row?.[columnIndex(CONVERSATION_LOG, '本文')] ?? ''),
  };
}

/** 処理メモに書く「対象外」の理由 */
const SKIP_REASON = Object.freeze({
  INTERNAL: '対象外 (社内)',
  UNREGISTERED: '対象外 (未登録)',
  DISABLED: '対象外 (無効)',
  UNKNOWN_KIND: '対象外 (区分が取引先ではない)',
  NOT_MESSAGE: '対象外 (メッセージ以外)',
  NOT_TEXT: '対象外 (テキスト以外)',
  EMPTY_TEXT: '対象外 (本文なし)',
  DIRECT_NOT_ADMIN: '対象外 (管理者以外の 1 対 1)',
  DIRECT_NOT_TEXT: '対象外 (1 対 1 のテキスト以外)',
});

/**
 * @typedef {{ kind: 'skip', memo: string }
 *   | { kind: 'await_draft', entry: LedgerEntry }
 *   | { kind: 'admin_command', text: string }} Triage
 */

/**
 * 会話ログ 1 行をどう扱うか決める。
 * - 1 対 1 (user): 管理者からのテキストは承認コマンド、それ以外は対象外。
 * - グループ: 台帳で 区分=取引先 かつ 有効=TRUE のテキストメッセージだけ返信案待ちにする。
 * @param {EventInfo} info
 * @param {Map<string, LedgerEntry>} ledger
 * @param {string | null | undefined} adminUserId
 * @returns {Triage}
 */
function triageEvent(info, ledger, adminUserId) {
  const admin = String(adminUserId ?? '').trim();

  if (info.sourceType === 'user') {
    if (admin === '' || info.userId !== admin) return { kind: 'skip', memo: SKIP_REASON.DIRECT_NOT_ADMIN };
    if (info.eventType !== 'message' || info.messageType !== 'text') {
      return { kind: 'skip', memo: SKIP_REASON.DIRECT_NOT_TEXT };
    }
    return { kind: 'admin_command', text: info.text };
  }

  const entry = ledger.get(info.groupId);
  if (!entry) return { kind: 'skip', memo: SKIP_REASON.UNREGISTERED };
  if (entry.kind === LEDGER_KIND.INTERNAL) return { kind: 'skip', memo: SKIP_REASON.INTERNAL };
  if (!entry.enabled) return { kind: 'skip', memo: SKIP_REASON.DISABLED };
  if (entry.kind !== LEDGER_KIND.CLIENT) return { kind: 'skip', memo: SKIP_REASON.UNKNOWN_KIND };
  if (info.eventType !== 'message') return { kind: 'skip', memo: SKIP_REASON.NOT_MESSAGE };
  if (info.messageType !== 'text') return { kind: 'skip', memo: SKIP_REASON.NOT_TEXT };
  if (info.text.trim() === '') return { kind: 'skip', memo: SKIP_REASON.EMPTY_TEXT };
  return { kind: 'await_draft', entry };
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
  /** 取引先グループの message。返信案担当が返信案を書くのを待っている */
  WAITING_DRAFT: '返信案待ち',
  /** 返信案を取り込み、管理者の OK/却下 を待っている */
  WAITING_APPROVAL: '承認待ち',
  /** 返信案担当が「人に回す」と判定した */
  HUMAN: '人に回す',
  /** グループへ返信を送った */
  REPLIED: '返信済',
});

/** 「返信案」タブの状態 */
const DRAFT_STATUS = Object.freeze({
  WAITING_APPROVAL: '承認待ち',
  HUMAN: '人に回す',
  SENT: '送信済',
  SEND_FAILED: '送信失敗',
  HELD: '送信保留',
  REJECTED: '却下',
});

/** 返信案担当が書く「判定」列の値 */
const VERDICT = Object.freeze({
  REPLY: '返信',
  HUMAN: '人に回す',
});

const LEDGER_KIND = Object.freeze({
  CLIENT: '取引先',
  INTERNAL: '社内',
});

const SETTING_KEYS = Object.freeze({
  MODE: 'mode',
  /** 自動登録の対象外にするグループ ID (カンマ区切り)。DEFAULT_AUTO_REGISTER_EXCLUDE に追加される */
  AUTO_REGISTER_EXCLUDE: 'auto_register_exclude',
});

/**
 * 台帳への自動登録 (join 時 / registerUnregisteredGroups) の対象外にするグループ ID。
 * 【全体連絡用】株式会社Quad は取引先ではなく、台帳の区分に関係なく返信対象外のままにする。
 * ID は秘密情報ではない (会話ログにそのまま記録される値)。
 */
const DEFAULT_AUTO_REGISTER_EXCLUDE = Object.freeze(['Cab4b7bb74101992bc1f9efc7d2fc7dde']);

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
    /** 第 3 歩で末尾に追加。グループ発 message の送信者の表示名 (Messaging API から取得)。既存列の添字は変えない */
    '送信者名',
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
    Object.freeze([
      SETTING_KEYS.AUTO_REGISTER_EXCLUDE,
      '',
      '台帳へ自動登録しないグループID (カンマ区切り)。全体連絡用グループはコード側で常に除外',
    ]),
  ]),
});

/** @type {SheetDefinition} */
const OPS_LOG = Object.freeze({
  name: '稼働ログ',
  headers: Object.freeze(['日時', 'レベル', '処理', 'グループID', '内容']),
});

/** 取り込んだ返信案。1 行 = 1 案。番号は管理者が OK/却下 で指す ID */
/** @type {SheetDefinition} */
const DRAFTS = Object.freeze({
  name: '返信案',
  headers: Object.freeze([
    '番号',
    'webhookEventId',
    'グループID',
    '会社名',
    '受信本文',
    '返信案',
    '判定',
    '理由',
    '状態',
    '作成日時',
    '承認日時',
    '送信結果',
    '取込元',
  ]),
});

/** 取り込み済みの返信案ファイル (同じファイルを二度読まないための記録) */
/** @type {SheetDefinition} */
const IMPORTED = Object.freeze({
  name: '取込済',
  headers: Object.freeze(['ファイルID', 'ファイル名', '取込日時', '取込件数', '重複件数', '備考']),
});

/**
 * 返信案担当が作るファイル (Google スプレッドシート or CSV) の 1 行目。
 * ファイル名は「LINE返信案_YYYYMMDD-HHMM」。
 */
const DRAFT_FILE_HEADERS = Object.freeze([
  'webhookEventId',
  'グループID',
  '会社名',
  '受信本文',
  '返信案',
  '判定',
  '理由',
]);
const DRAFT_FILE_NAME_PREFIX = 'LINE返信案_';
const DRAFT_FILE_NAME_PATTERN = /^LINE返信案_\d{8}-\d{4}/;

/** @type {readonly SheetDefinition[]} */
const ALL_SHEETS = Object.freeze([CONVERSATION_LOG, LEDGER, SETTINGS, OPS_LOG, DRAFTS, IMPORTED]);

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
