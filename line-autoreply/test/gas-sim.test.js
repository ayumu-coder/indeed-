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

function createGasContext({ settingsRows, ledgerRows, files = [], props = {} }) {
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
        const payload = JSON.parse(opts.payload);
        pushes.push({ to: payload.to, text: payload.messages[0].text });
        assert.equal(opts.headers.Authorization, 'Bearer token-for-test');
        const fail = payload.to === 'Cfail';
        return { getResponseCode: () => (fail ? 400 : 200), getContentText: () => (fail ? '{"message":"bad"}' : '{}') };
      },
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
  return { ctx, sheets, pushes, run: (code) => vm.runInContext(code, ctx) };
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

const DRAFT_HEADER = 'webhookEventId,グループID,会社名,受信本文,返信案,判定,理由';

test('setup: 6 枚のシートができ、既存シートの見出しは上書きされるだけ', () => {
  const { sheets } = createGasContext({ settingsRows: [['mode', 'approval']], ledgerRows: [] });
  assert.deepEqual([...sheets.keys()], ['会話ログ', '取引先台帳', '設定', '稼働ログ', '返信案', '取込済']);
  assert.deepEqual(sheets.get(IMPORTED.name).rows[0], [...IMPORTED.headers]);
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
