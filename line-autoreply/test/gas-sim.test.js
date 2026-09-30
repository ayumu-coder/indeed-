// gas/Code.gs 全体を、SpreadsheetApp / DriveApp / UrlFetchApp などの最小モックの上で実行し、
// processQueue → importDrafts → 承認コマンド → 送信 の流れを通す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { OUTPUT_PATH } from '../scripts/build-gas.js';
import { CONVERSATION_LOG, DRAFTS, IMPORTED, LEDGER, SETTINGS, columnIndex } from '../lib/schema.js';
import { eventToRow } from '../lib/events.js';

const CODE = readFileSync(OUTPUT_PATH, 'utf8');
const ADMIN = 'Uadmin';

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  getName() {
    return this.name;
  }
  getLastRow() {
    return this.rows.length;
  }
  getDataRange() {
    const width = Math.max(1, ...this.rows.map((r) => r.length));
    return this.getRange(1, 1, Math.max(1, this.rows.length), width);
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r += 1) {
          const src = sheet.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c += 1) line.push(src[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        values.forEach((line, r) => {
          const idx = row - 1 + r;
          while (sheet.rows.length <= idx) sheet.rows.push([]);
          line.forEach((v, c) => {
            sheet.rows[idx][col - 1 + c] = v;
          });
        });
        return this;
      },
      setValue(v) {
        return this.setValues([[v]]);
      },
      setFontWeight() {
        return this;
      },
    };
  }
  appendRow(values) {
    this.rows.push(values.slice());
  }
  setFrozenRows() {}
}

/**
 * Messaging API の取得系 (グループ概要 / メンバープロフィール) のスタブ。
 * groups: groupId → グループ名 (無ければ 404)、members: `${groupId}:${userId}` → 表示名 (無ければ 404)。
 */
function createLineApiStub({ groups = {}, members = {} } = {}) {
  const calls = [];
  const json = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  return {
    calls,
    handle(url, opts) {
      const summary = /^https:\/\/api\.line\.me\/v2\/bot\/group\/([^/]+)\/summary$/.exec(url);
      const member = /^https:\/\/api\.line\.me\/v2\/bot\/group\/([^/]+)\/member\/([^/]+)$/.exec(url);
      if (!summary && !member) return null;
      assert.equal(opts.method, 'get');
      assert.equal(opts.headers.Authorization, 'Bearer token-for-test');
      assert.equal(opts.payload, undefined);
      calls.push(url);
      if (summary) {
        const name = groups[decodeURIComponent(summary[1])];
        return name === undefined ? json(404, { message: 'Not found' }) : json(200, { groupId: summary[1], groupName: name, count: 3 });
      }
      const name = members[`${decodeURIComponent(member[1])}:${decodeURIComponent(member[2])}`];
      return name === undefined ? json(404, { message: 'Not found' }) : json(200, { userId: member[2], displayName: name });
    },
  };
}

function createGasContext({ settingsRows, ledgerRows, files = [], props = {}, lineApi = createLineApiStub() }) {
  const sheets = new Map();
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => {
      const s = new FakeSheet(n);
      sheets.set(n, s);
      return s;
    },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name),
  };
  const pushes = [];
  const cache = new Map();
  const properties = { ADMIN_USER_ID: ADMIN, LINE_CHANNEL_ACCESS_TOKEN: 'token-for-test', DRAFT_FOLDER_ID: 'folder1', ...props };
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: (id) => {
        const f = files.find((x) => x.id === id);
        return { getSheets: () => [{ getDataRange: () => ({ getValues: () => f.values }) }] };
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties[k] ?? null, setProperty: () => {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', CSV: 'text/csv' },
    DriveApp: {
      getFolderById: () => ({
        getFiles: () => {
          let i = 0;
          return {
            hasNext: () => i < files.length,
            next: () => {
              const f = files[i++];
              return {
                getId: () => f.id,
                getName: () => f.name,
                getMimeType: () => f.mime,
                getBlob: () => ({ getDataAsString: () => f.csv }),
              };
            },
          };
        },
      }),
    },
    Utilities: {
      getUuid: () => 'uuid',
      parseCsv: (text) => text.trim().split('\n').map((l) => l.split(',')),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const apiResponse = lineApi.handle(url, opts);
        if (apiResponse) return apiResponse;
        assert.equal(url, 'https://api.line.me/v2/bot/message/push');
        const payload = JSON.parse(opts.payload);
        pushes.push({ to: payload.to, text: payload.messages[0].text });
        assert.equal(opts.headers.Authorization, 'Bearer token-for-test');
        const fail = payload.to === 'Cfail';
        return { getResponseCode: () => (fail ? 400 : 200), getContentText: () => (fail ? '{"message":"bad"}' : '{}') };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k).value : null),
        put: (k, v, seconds) => {
          assert.equal(typeof v, 'string');
          assert.ok(seconds > 0 && seconds <= 21600, 'CacheService の上限は 6 時間');
          cache.set(k, { value: v, seconds });
        },
      }),
    },
    Logger: { log: () => {} },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { TEXT: 'text' } },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });
  vm.runInContext('setup()', ctx);
  const settings = sheets.get(SETTINGS.name);
  settings.rows = [settings.rows[0], ...settingsRows];
  const ledger = sheets.get(LEDGER.name);
  ledger.rows = [ledger.rows[0], ...ledgerRows];
  return { ctx, sheets, pushes, cache, api: lineApi, run: (code) => vm.runInContext(code, ctx) };
}

const LEDGER_ROWS = [
  ['Cclient', '株式会社サンプル商事', 'g', '取引先', '', '', '山田', true, ''],
  ['Cother', '合同会社テスト工業', 'g', '取引先', '', '', '佐藤', true, ''],
  ['Cinternal', '当社', 'g', '社内', '', '', '', true, ''],
  ['Cfail', '送信失敗社', 'g', '取引先', '', '', '', true, ''],
];

function logRow(sheets, event) {
  sheets.get(CONVERSATION_LOG.name).rows.push(eventToRow(event, new Date(0)));
}
const groupMsg = (groupId, text, id) => ({
  type: 'message',
  source: { type: 'group', groupId, userId: 'Ux' },
  message: { type: 'text', text },
  webhookEventId: id,
});
const adminMsg = (text, id) => ({ type: 'message', source: { type: 'user', userId: ADMIN }, message: { type: 'text', text }, webhookEventId: id });
const col = (def, h) => columnIndex(def, h);
const logRows = (sheets) => sheets.get(CONVERSATION_LOG.name).rows.slice(1);
const draftRows = (sheets) => sheets.get(DRAFTS.name).rows.slice(1);
const ledgerRows = (sheets) => sheets.get(LEDGER.name).rows.slice(1);
const opsRows = (sheets) => sheets.get('稼働ログ').rows.slice(1);
const QUAD_ALL = 'Cab4b7bb74101992bc1f9efc7d2fc7dde';

const DRAFT_HEADER = 'webhookEventId,グループID,会社名,受信本文,返信案,判定,理由';

test('setup: 6 枚のシートができ、既存シートの見出しは上書きされるだけ', () => {
  const { sheets } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: [] });
  assert.deepEqual([...sheets.keys()], ['会話ログ', '取引先台帳', '設定', '稼働ログ', '返信案', '取込済']);
  assert.deepEqual(sheets.get(IMPORTED.name).rows[0], [...IMPORTED.headers]);
  assert.equal(sheets.get(CONVERSATION_LOG.name).rows[0].at(-1), '送信者名', '再実行で末尾に 送信者名 の見出しが足される');
});

test('processQueue: 台帳照合で 返信案待ち / 対象外 (社内・未登録) / join を振り分ける', () => {
  const { sheets, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS });
  logRow(sheets, groupMsg('Cclient', '納期はいつですか', 'e1'));
  logRow(sheets, groupMsg('Cinternal', '社内の話', 'e2'));
  logRow(sheets, groupMsg('Cunknown', '未登録', 'e3'));
  logRow(sheets, { type: 'join', source: { type: 'group', groupId: 'Cclient' }, webhookEventId: 'e4' });
  logRow(sheets, { type: 'message', source: { type: 'user', userId: 'Ustranger' }, message: { type: 'text', text: 'OK 1' }, webhookEventId: 'e5' });
  run('processQueue()');
  const rows = logRows(sheets);
  const status = (i) => rows[i][col(CONVERSATION_LOG, '状態')];
  const memo = (i) => rows[i][col(CONVERSATION_LOG, '処理メモ')];
  assert.equal(status(0), '返信案待ち');
  assert.equal(memo(0), '返信案待ち: 株式会社サンプル商事');
  assert.equal(status(1), '処理済');
  assert.equal(memo(1), '対象外 (社内)');
  assert.equal(status(2), '処理済');
  assert.equal(memo(2), '対象外 (未登録)');
  assert.equal(status(3), '処理済');
  assert.equal(memo(3), '対象外 (メッセージ以外)');
  assert.equal(status(4), '処理済');
  assert.equal(memo(4), '対象外 (管理者以外の 1 対 1)');
  assert.ok(rows.every((r) => r[col(CONVERSATION_LOG, '処理日時')] !== ''));
});

test('importDrafts (approval): 取込 → 承認依頼 push → OK で送信 → 返信済。重複ファイルは再取込しない', () => {
  const file = {
    id: 'f1',
    name: 'LINE返信案_20260930-1000',
    mime: 'application/vnd.google-apps.spreadsheet',
    values: [
      DRAFT_HEADER.split(','),
      ['e1', 'Cclient', '株式会社サンプル商事', '納期はいつですか', '山田です。来週金曜の予定です。よろしくお願いいたします。', '返信', ''],
      ['e9', 'Cclient', '株式会社サンプル商事', '値引きできますか', '', '人に回す', '金額の話のため'],
    ],
  };
  const { sheets, pushes, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, files: [file] });
  logRow(sheets, groupMsg('Cclient', '納期はいつですか', 'e1'));
  logRow(sheets, groupMsg('Cclient', '値引きできますか', 'e9'));
  run('processQueue()');
  run('importDrafts()');

  const drafts = draftRows(sheets);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0][col(DRAFTS, '番号')], 1);
  assert.equal(drafts[0][col(DRAFTS, '状態')], '承認待ち');
  assert.equal(drafts[0][col(DRAFTS, '取込元')], 'LINE返信案_20260930-1000');
  assert.equal(drafts[1][col(DRAFTS, '番号')], 2);
  assert.equal(drafts[1][col(DRAFTS, '状態')], '人に回す');
  assert.equal(logRows(sheets)[0][col(CONVERSATION_LOG, '状態')], '承認待ち');
  assert.equal(logRows(sheets)[1][col(CONVERSATION_LOG, '状態')], '人に回す');
  assert.equal(sheets.get(IMPORTED.name).rows[1][0], 'f1');

  assert.equal(pushes.length, 2);
  assert.equal(pushes[0].to, ADMIN);
  assert.match(pushes[0].text, /^案 #1【株式会社サンプル商事】\n受信: 納期はいつですか\n返信案: 山田です。/);
  assert.match(pushes[0].text, /『OK 1』/);
  assert.match(pushes[1].text, /^人に回す #2【株式会社サンプル商事】/);
  assert.ok(!pushes[1].text.includes('OK'));

  // 2 回目の importDrafts は同じファイルを読まない
  run('importDrafts()');
  assert.equal(draftRows(sheets).length, 2);
  assert.equal(pushes.length, 2);

  // 管理者が OK 1 → グループへ送信 → 送信済 / 返信済
  logRow(sheets, adminMsg('ＯＫ　1', 'e10'));
  run('processQueue()');
  assert.equal(pushes[2].to, 'Cclient');
  assert.equal(pushes[2].text, '山田です。来週金曜の予定です。よろしくお願いいたします。');
  assert.equal(draftRows(sheets)[0][col(DRAFTS, '状態')], '送信済');
  assert.notEqual(draftRows(sheets)[0][col(DRAFTS, '承認日時')], '');
  assert.equal(logRows(sheets)[0][col(CONVERSATION_LOG, '状態')], '返信済');
  assert.equal(logRows(sheets)[2][col(CONVERSATION_LOG, '処理メモ')], 'OK #1: 送信済');
  assert.match(pushes[3].text, /^送信しました #1/);

  // 同じ番号をもう一度 OK → 該当なし。人に回すの番号に OK → 該当なし
  logRow(sheets, adminMsg('OK 1', 'e11'));
  logRow(sheets, adminMsg('OK 2', 'e12'));
  logRow(sheets, adminMsg('却下 99', 'e13'));
  logRow(sheets, adminMsg('こんにちは', 'e14'));
  run('processQueue()');
  const tail = logRows(sheets).slice(-4).map((r) => r[col(CONVERSATION_LOG, '処理メモ')]);
  assert.deepEqual(tail, ['OK #1: 該当なし', 'OK #2: 該当なし', '却下 #99: 該当なし', '管理者メッセージ (承認コマンドではない)']);
  assert.match(pushes[4].text, /該当なし: #1 は「送信済」/);
  assert.match(pushes[5].text, /該当なし: #2 は「人に回す」/);
  assert.match(pushes[6].text, /該当なし: #99 の返信案はありません/);
  assert.equal(pushes.length, 7);
});

test('却下: 状態が 却下 になり、会話ログは 処理済。グループには送らない', () => {
  const file = {
    id: 'f1',
    name: 'LINE返信案_20260930-1000.csv',
    mime: 'text/csv',
    csv: `${DRAFT_HEADER}\ne1,Cclient,株式会社サンプル商事,q,返信文です。,返信,\n`,
  };
  const { sheets, pushes, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, files: [file] });
  logRow(sheets, groupMsg('Cclient', 'q', 'e1'));
  run('processQueue()');
  run('importDrafts()');
  logRow(sheets, adminMsg('却下 1', 'e2'));
  run('processQueue()');
  assert.equal(draftRows(sheets)[0][col(DRAFTS, '状態')], '却下');
  assert.equal(logRows(sheets)[0][col(CONVERSATION_LOG, '状態')], '処理済');
  assert.ok(pushes.every((p) => p.to === ADMIN));
});

test('OK 時の安全確認: 円・他社名を含む案は送らず 送信保留 にして管理者へ理由を送る', () => {
  const file = {
    id: 'f1',
    name: 'LINE返信案_20260930-1000',
    mime: 'application/vnd.google-apps.spreadsheet',
    values: [
      DRAFT_HEADER.split(','),
      ['e1', 'Cclient', '株式会社サンプル商事', 'q', '合同会社テスト工業と同じく 1,000円です。', '返信', ''],
    ],
  };
  const { sheets, pushes, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, files: [file] });
  logRow(sheets, groupMsg('Cclient', 'q', 'e1'));
  run('processQueue()');
  run('importDrafts()');
  logRow(sheets, adminMsg('OK 1', 'e2'));
  run('processQueue()');
  assert.equal(draftRows(sheets)[0][col(DRAFTS, '状態')], '送信保留');
  assert.match(draftRows(sheets)[0][col(DRAFTS, '送信結果')], /金額表現「円」/);
  assert.match(draftRows(sheets)[0][col(DRAFTS, '送信結果')], /他社名「合同会社テスト工業」/);
  assert.ok(pushes.every((p) => p.to === ADMIN), 'グループへは送っていない');
  assert.match(pushes.at(-1).text, /^送信保留 #1/);
});

test('mode=auto: 安全確認を通った案は承認なしで送信、通らない案は 送信保留、人に回すは通知のみ。社内へは送らない', () => {
  const file = {
    id: 'f1',
    name: 'LINE返信案_20260930-1000',
    mime: 'application/vnd.google-apps.spreadsheet',
    values: [
      DRAFT_HEADER.split(','),
      ['e1', 'Cclient', '株式会社サンプル商事', 'q1', '山田です。承知しました。よろしくお願いいたします。', '返信', ''],
      ['e2', 'Cclient', '株式会社サンプル商事', 'q2', '単価は 500円です。', '返信', ''],
      ['e3', 'Cclient', '株式会社サンプル商事', 'q3', '', '人に回す', 'クレーム'],
      ['e4', 'Cinternal', '当社', 'q4', '社内向けの返信', '返信', ''],
      ['e5', 'Cfail', '送信失敗社', 'q5', '送れない返信', '返信', ''],
    ],
  };
  const { sheets, pushes, run } = createGasContext({ settingsRows: [['mode', 'auto']], ledgerRows: LEDGER_ROWS, files: [file] });
  ['e1', 'e2', 'e3'].forEach((id, i) => logRow(sheets, groupMsg('Cclient', `q${i + 1}`, id)));
  logRow(sheets, groupMsg('Cinternal', 'q4', 'e4'));
  logRow(sheets, groupMsg('Cfail', 'q5', 'e5'));
  run('processQueue()');
  run('importDrafts()');

  const d = draftRows(sheets);
  assert.deepEqual(
    d.map((r) => r[col(DRAFTS, '状態')]),
    ['送信済', '送信保留', '人に回す', '送信保留', '送信失敗'],
  );
  assert.match(d[3][col(DRAFTS, '送信結果')], /取引先ではない/);
  assert.match(d[4][col(DRAFTS, '送信結果')], /HTTP 400/);
  const groupPushes = pushes.filter((p) => p.to !== ADMIN);
  assert.deepEqual(groupPushes.map((p) => p.to), ['Cclient', 'Cfail']);
  assert.equal(groupPushes[0].text, '山田です。承知しました。よろしくお願いいたします。');
  assert.ok(!pushes.some((p) => p.to === 'Cinternal'));
  const logStatus = logRows(sheets).map((r) => r[col(CONVERSATION_LOG, '状態')]);
  assert.deepEqual(logStatus, ['返信済', '人に回す', '人に回す', '人に回す', 'エラー']);
});

test('importDrafts: 見出しが壊れたファイルは取込済に不備として記録し、二度と読まない', () => {
  const file = { id: 'fbad', name: 'LINE返信案_20260930-1000', mime: 'application/vnd.google-apps.spreadsheet', values: [['a', 'b']] };
  const { sheets, pushes, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, files: [file] });
  run('importDrafts()');
  run('importDrafts()');
  const imported = sheets.get(IMPORTED.name).rows.slice(1);
  assert.equal(imported.length, 1);
  assert.match(String(imported[0][5]), /見出し「webhookEventId」がありません/);
  assert.equal(draftRows(sheets).length, 0);
  assert.equal(pushes.length, 0);
});

test('importDrafts: DRAFT_FOLDER_ID 未設定なら何もせず稼働ログに WARN', () => {
  const { sheets, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, props: { DRAFT_FOLDER_ID: null } });
  run('importDrafts()');
  const ops = sheets.get('稼働ログ').rows.slice(1);
  assert.ok(ops.some((r) => r[1] === 'WARN' && /DRAFT_FOLDER_ID/.test(String(r[4]))));
});

// ---------- 第 3 歩: join 時の自動登録 / 一括登録 / 送信者名 ----------

const joinEvent = (groupId, id) => ({ type: 'join', source: { type: 'group', groupId }, webhookEventId: id });
const leaveEvent = (groupId, id) => ({ type: 'leave', source: { type: 'group', groupId }, webhookEventId: id });

test('join 自動登録: 未登録グループの join でグループ名を取得して台帳へ 1 行追加し、同じバッチの後続メッセージは 返信案待ち になる', () => {
  const api = createLineApiStub({ groups: { Cnew: '株式会社新規×Quad' }, members: { 'Cnew:Ux': '新規 太郎' } });
  const { sheets, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, lineApi: api });
  logRow(sheets, joinEvent('Cnew', 'e1'));
  logRow(sheets, groupMsg('Cnew', 'はじめまして', 'e2'));
  logRow(sheets, joinEvent('Cclient', 'e3'));
  run('processQueue()');

  const added = ledgerRows(sheets).slice(LEDGER_ROWS.length);
  assert.equal(added.length, 1, '既存行は触らず 1 行だけ増える');
  assert.deepEqual(ledgerRows(sheets).slice(0, LEDGER_ROWS.length), LEDGER_ROWS);
  const get = (h) => added[0][col(LEDGER, h)];
  assert.equal(get('グループID'), 'Cnew');
  assert.equal(get('会社名'), '株式会社新規×Quad');
  assert.equal(get('グループ名'), '株式会社新規×Quad');
  assert.equal(get('区分'), '取引先');
  assert.equal(get('有効'), true);
  assert.equal(get('担当者'), '');
  assert.match(String(get('備考')), /^自動登録 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  const rows = logRows(sheets);
  assert.equal(rows[0][col(CONVERSATION_LOG, '状態')], '処理済');
  assert.equal(rows[0][col(CONVERSATION_LOG, '処理メモ')], '自動登録: 株式会社新規×Quad');
  assert.equal(rows[1][col(CONVERSATION_LOG, '状態')], '返信案待ち');
  assert.equal(rows[1][col(CONVERSATION_LOG, '処理メモ')], '返信案待ち: 株式会社新規×Quad');
  assert.equal(rows[1][col(CONVERSATION_LOG, '送信者名')], '新規 太郎');
  assert.equal(rows[2][col(CONVERSATION_LOG, '処理メモ')], '対象外 (メッセージ以外)', '登録済グループの join は今までどおり');
  assert.deepEqual(
    api.calls,
    ['https://api.line.me/v2/bot/group/Cnew/summary', 'https://api.line.me/v2/bot/group/Cnew/member/Ux'],
    '退会 API や push は呼ばない',
  );
  assert.ok(opsRows(sheets).some((r) => r[1] === 'INFO' && r[3] === 'Cnew' && /台帳へ自動登録/.test(String(r[4]))));
});

test('join 自動登録: グループ名 API が失敗しても会社名空で登録し WARN。全体連絡用グループは登録しない', () => {
  const api = createLineApiStub();
  const { sheets, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, lineApi: api });
  logRow(sheets, joinEvent('Cnoname', 'e1'));
  logRow(sheets, joinEvent(QUAD_ALL, 'e2'));
  run('processQueue()');

  const added = ledgerRows(sheets).slice(LEDGER_ROWS.length);
  assert.equal(added.length, 1);
  assert.equal(added[0][col(LEDGER, 'グループID')], 'Cnoname');
  assert.equal(added[0][col(LEDGER, '会社名')], '');
  assert.equal(added[0][col(LEDGER, '区分')], '取引先');
  assert.equal(added[0][col(LEDGER, '有効')], true);
  const memos = logRows(sheets).map((r) => r[col(CONVERSATION_LOG, '処理メモ')]);
  assert.deepEqual(memos, ['自動登録: (グループ名を取得できず)', '対象外 (未登録)']);
  assert.ok(opsRows(sheets).some((r) => r[1] === 'WARN' && r[3] === 'Cnoname' && /HTTP 404/.test(String(r[4]))));
  assert.ok(!api.calls.some((u) => u.includes(QUAD_ALL)), '全体連絡用は API も呼ばない');
});

test('registerUnregisteredGroups: 会話ログにあって台帳に無いグループを一括登録。leave 済・除外・登録済は対象外。2 回目は何もしない', () => {
  const api = createLineApiStub({ groups: { Ca: 'A社', Cb: 'B社', Cback: '戻ってきた社' } });
  const { sheets, run } = createGasContext({
    settingsRows: [['mode', 'approval'], ['auto_register_exclude', 'Cexcluded']],
    ledgerRows: LEDGER_ROWS,
    lineApi: api,
  });
  // 既に 処理済 (対象外 未登録) になっている過去ログを再現する
  logRow(sheets, joinEvent('Ca', 'e1'));
  logRow(sheets, groupMsg('Ca', '見積の件', 'e2'));
  logRow(sheets, joinEvent('Cb', 'e3'));
  logRow(sheets, joinEvent('Cgone', 'e4'));
  logRow(sheets, leaveEvent('Cgone', 'e5'));
  logRow(sheets, joinEvent('Cback', 'e6'));
  logRow(sheets, leaveEvent('Cback', 'e7'));
  logRow(sheets, joinEvent('Cback', 'e8'));
  logRow(sheets, joinEvent('Cexcluded', 'e9'));
  logRow(sheets, joinEvent(QUAD_ALL, 'e10'));
  logRow(sheets, groupMsg('Cclient', '登録済', 'e11'));
  logRows(sheets).forEach((r) => {
    r[col(CONVERSATION_LOG, '状態')] = '処理済';
  });

  run('registerUnregisteredGroups()');
  const added = ledgerRows(sheets).slice(LEDGER_ROWS.length);
  assert.deepEqual(
    added.map((r) => [r[col(LEDGER, 'グループID')], r[col(LEDGER, '会社名')], r[col(LEDGER, '区分')], r[col(LEDGER, '有効')]]),
    [
      ['Ca', 'A社', '取引先', true],
      ['Cb', 'B社', '取引先', true],
      ['Cback', '戻ってきた社', '取引先', true],
    ],
  );
  assert.deepEqual(ledgerRows(sheets).slice(0, LEDGER_ROWS.length), LEDGER_ROWS, '既存行は書き換えない');
  const ops = opsRows(sheets).filter((r) => r[2] === 'registerUnregisteredGroups');
  assert.ok(ops.some((r) => r[1] === 'INFO' && r[3] === 'Ca' && /グループ名「A社」/.test(String(r[4]))));
  assert.ok(ops.some((r) => r[1] === 'INFO' && r[3] === 'Cb' && /グループ名「B社」/.test(String(r[4]))));
  assert.ok(ops.some((r) => r[1] === 'INFO' && /3 件中 3 件/.test(String(r[4]))));
  assert.equal(api.calls.length, 3);
  assert.ok(!api.calls.some((u) => /Cgone|Cexcluded|Cclient/.test(u) || u.includes(QUAD_ALL)));

  // 2 回目は増えない
  run('registerUnregisteredGroups()');
  assert.equal(ledgerRows(sheets).length, LEDGER_ROWS.length + 3);
  assert.equal(api.calls.length, 3);
  assert.ok(opsRows(sheets).some((r) => /未登録のグループはありません/.test(String(r[4]))));

  // 登録後に届いたメッセージは 返信案待ち になる (会社名=グループ名)
  logRow(sheets, groupMsg('Ca', '納期を教えてください', 'e12'));
  run('processQueue()');
  const last = logRows(sheets).at(-1);
  assert.equal(last[col(CONVERSATION_LOG, '状態')], '返信案待ち');
  assert.equal(last[col(CONVERSATION_LOG, '処理メモ')], '返信案待ち: A社');
});

test('送信者名: グループ発 message で displayName を取得して末尾列に書き、(groupId,userId) ごとにキャッシュする。失敗は空のまま WARN', () => {
  const api = createLineApiStub({ members: { 'Cclient:Ux': '山田 太郎', 'Cinternal:Ux': '社内 花子' } });
  const { sheets, cache, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, lineApi: api });
  logRow(sheets, groupMsg('Cclient', '1 通目', 'e1'));
  logRow(sheets, groupMsg('Cclient', '2 通目 (同じ人)', 'e2'));
  logRow(sheets, { ...groupMsg('Cclient', '別の人', 'e3'), source: { type: 'group', groupId: 'Cclient', userId: 'Uunknown' } });
  logRow(sheets, groupMsg('Cinternal', '社内でも名前は取る', 'e4'));
  logRow(sheets, { ...groupMsg('Cclient', 'スタンプ', 'e5'), message: { type: 'sticker', packageId: '1', stickerId: '2' } });
  logRow(sheets, adminMsg('こんにちは', 'e6'));
  logRow(sheets, joinEvent('Cclient', 'e7'));
  run('processQueue()');

  const senders = logRows(sheets).map((r) => r[col(CONVERSATION_LOG, '送信者名')] ?? '');
  assert.deepEqual(senders, ['山田 太郎', '山田 太郎', '', '社内 花子', '山田 太郎', '', '']);
  assert.deepEqual(
    api.calls,
    [
      'https://api.line.me/v2/bot/group/Cclient/member/Ux',
      'https://api.line.me/v2/bot/group/Cclient/member/Uunknown',
      'https://api.line.me/v2/bot/group/Cinternal/member/Ux',
    ],
    '同じ (groupId,userId) は 1 回しか呼ばない',
  );
  assert.equal(cache.get('sender:Cclient:Ux').seconds, 6 * 60 * 60);
  assert.ok(cache.get('sender:Cclient:Uunknown').seconds < 6 * 60 * 60, '失敗は短いキャッシュ');
  assert.ok(opsRows(sheets).some((r) => r[1] === 'WARN' && r[2] === 'senderName' && /HTTP 404/.test(String(r[4]))));
  // 振り分け結果は第 2 歩と変わらない
  const status = logRows(sheets).map((r) => r[col(CONVERSATION_LOG, '状態')]);
  assert.deepEqual(status, ['返信案待ち', '返信案待ち', '返信案待ち', '処理済', '処理済', '処理済', '処理済']);
  // 生データ列 (既存の末尾) はそのまま
  assert.ok(String(logRows(sheets)[0][col(CONVERSATION_LOG, '生データ')]).startsWith('{'));
});

test('送信者名: 承認依頼と人に回す通知に「受信 (送信者名): …」として出る', () => {
  const api = createLineApiStub({ members: { 'Cclient:Ux': '山田 太郎' } });
  const file = {
    id: 'f1',
    name: 'LINE返信案_20260930-1000',
    mime: 'application/vnd.google-apps.spreadsheet',
    values: [
      DRAFT_HEADER.split(','),
      ['e1', 'Cclient', '株式会社サンプル商事', '納期はいつですか', '山田です。来週金曜の予定です。', '返信', ''],
      ['e2', 'Cclient', '株式会社サンプル商事', '値引きできますか', '', '人に回す', '金額の話のため'],
    ],
  };
  const { sheets, pushes, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, files: [file], lineApi: api });
  logRow(sheets, groupMsg('Cclient', '納期はいつですか', 'e1'));
  logRow(sheets, groupMsg('Cclient', '値引きできますか', 'e2'));
  run('processQueue()');
  run('importDrafts()');
  assert.equal(pushes.length, 2);
  assert.match(pushes[0].text, /^案 #1【株式会社サンプル商事】\n受信 \(山田 太郎\): 納期はいつですか\n/);
  assert.match(pushes[1].text, /^人に回す #2【株式会社サンプル商事】\n受信 \(山田 太郎\): 値引きできますか\n/);
});

test('会社名が空の自動登録グループでも、承認済みの返信は送信できる (安全確認は 区分=取引先 かつ 有効 のみ)', () => {
  const file = {
    id: 'f1',
    name: 'LINE返信案_20260930-1000',
    mime: 'application/vnd.google-apps.spreadsheet',
    values: [DRAFT_HEADER.split(','), ['e2', 'Cnoname', '', 'q', '承知しました。よろしくお願いいたします。', '返信', '']],
  };
  const { sheets, pushes, run } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: LEDGER_ROWS, files: [file] });
  logRow(sheets, joinEvent('Cnoname', 'e1'));
  logRow(sheets, groupMsg('Cnoname', 'q', 'e2'));
  run('processQueue()');
  assert.equal(ledgerRows(sheets).at(-1)[col(LEDGER, '会社名')], '');
  run('importDrafts()');
  logRow(sheets, adminMsg('OK 1', 'e3'));
  run('processQueue()');
  assert.equal(draftRows(sheets)[0][col(DRAFTS, '状態')], '送信済');
  assert.deepEqual(pushes.filter((p) => p.to !== ADMIN).map((p) => p.to), ['Cnoname']);
});
