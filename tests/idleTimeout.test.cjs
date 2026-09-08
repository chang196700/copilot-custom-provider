const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const Module = require('node:module');
const originalLoad = Module._load;
const settings = { requestIdleTimeoutSeconds: 300 };
Module._load = function (id, ...args) {
 if (id === 'vscode') return {
  workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
  window: { createOutputChannel: () => ({ appendLine() {} }) },
  EventEmitter: class { event() {} dispose() {} },
  env: { language: 'zh-cn' },
 };
 return originalLoad.call(this, id, ...args);
};
const { IdleTimeoutRequest } = require('../out/protocol/idleTimeout');
const { resolveRequestIdleTimeout } = require('../out/requestTimeout');
const { migrate } = require('../out/store/schema');
const { AggregateChatProvider } = require('../out/provider/aggregate');
const drivers = ['openai', 'anthropic', 'gemini', 'azure'].map(name => {
 const exports = require('../out/protocol/' + name);
 return Object.values(exports).find(value => typeof value === 'function' && value.prototype.streamChatCompletion);
});
require('../out/i18n').initI18n({ extensionPath: require('node:path').resolve(__dirname, '..') });
Module._load = originalLoad;

function cancellation() {
 const listeners = new Set();
 return {
  isCancellationRequested: false,
  onCancellationRequested(fn) { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
  cancel() { this.isCancellationRequested = true; for (const fn of listeners) fn(); },
  get listenerCount() { return listeners.size; },
 };
}
async function server(t, handler) {
 const s = createServer(handler);
 await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
 t.after(() => { s.closeAllConnections(); return new Promise(resolve => s.close(resolve)); });
 return `http://127.0.0.1:${s.address().port}`;
}
function request(t, seconds = 0.15) {
 const token = cancellation();
 const r = new IdleTimeoutRequest(seconds, token, 'idle timeout');
 t.after(() => r.dispose());
 return { r, token };
}

test('configuration inheritance, bounds and migration', () => {
 assert.equal(resolveRequestIdleTimeout(undefined, undefined), 300);
 assert.equal(resolveRequestIdleTimeout(undefined, 600), 600);
 assert.equal(resolveRequestIdleTimeout(0, 600), 0);
 assert.equal(resolveRequestIdleTimeout(2147483, 600), 2147483);
 for (const value of [-1, 1.5, NaN, Infinity, '30', null, 2147484]) {
  assert.equal(resolveRequestIdleTimeout(value, 600), 600);
  assert.equal(resolveRequestIdleTimeout(value, value), 300);
 }
 const p = { id: 'p', name: 'p', type: 'openai-compatible', baseUrl: '', keyStorage: 'secret', models: [] };
 assert.deepEqual(migrate({ schemaVersion: 1, providers: [p] }), { schemaVersion: 2, providers: [p] });
 assert.equal(migrate({ providers: [{ ...p, requestIdleTimeoutSeconds: 0 }] }).providers[0].requestIdleTimeoutSeconds, 0);
 assert.deepEqual(migrate({ providers: [{ ...p, requestIdleTimeoutSeconds: -1 }] }).providers[0], p);
});

test('snapshot captures timeout before asynchronous key lookup', async () => {
 let release;
 const p = { id: 'p', type: 'openai-compatible', keyStorage: 'secret' };
 const aggregate = new AggregateChatProvider({ get: () => structuredClone(p), secrets: { get: () => new Promise(resolve => { release = resolve; }) } });
 settings.requestIdleTimeoutSeconds = 600;
 const pending = aggregate.makeSnapshot('p');
 settings.requestIdleTimeoutSeconds = 20;
 p.requestIdleTimeoutSeconds = 10;
 release('key');
 assert.equal((await pending).requestIdleTimeoutSeconds, 600);
 const next = aggregate.makeSnapshot('p'); release('key');
 assert.equal((await next).requestIdleTimeoutSeconds, 10);
 aggregate.dispose();
});

test('timeout while waiting for headers', async t => {
 const url = await server(t, () => {});
 const { r, token } = request(t);
 await assert.rejects(r.fetch(url, {}), { name: 'RequestIdleTimeoutError' });
 r.dispose();
 assert.equal(token.listenerCount, 0);
 assert.equal(r.timer, undefined);
});

test('timeout after response headers and a stalled body', async t => {
 const url = await server(t, (_, res) => { res.writeHead(200); res.flushHeaders(); res.write(': heartbeat\n\n'); });
 const { r } = request(t);
 const response = await r.fetch(url, {});
 await assert.rejects(response.text(), { name: 'RequestIdleTimeoutError' });
 assert.throws(() => r.throwIfTimedOut(), { name: 'RequestIdleTimeoutError' });
});

test('headers reset timer; heartbeats and output keep a long stream alive', async t => {
 const url = await server(t, (_, res) => {
  const start = setTimeout(() => {
   res.writeHead(200); res.flushHeaders();
   let count = 0;
   const interval = setInterval(() => {
    res.write(count % 2 ? ': heartbeat\n\n' : 'data: {"thinking":"working","tool_calls":[]}\n\n');
    if (++count === 8) { clearInterval(interval); res.end(); }
   }, 60);
   res.on('close', () => clearInterval(interval));
  }, 90);
  res.on('close', () => clearTimeout(start));
 });
 const { r, token } = request(t, 0.2);
 const response = await r.fetch(url, {});
 assert.match(await response.text(), /heartbeat/);
 r.dispose();
 await delay(220);
 assert.equal(r.error, undefined);
 assert.equal(r.timer, undefined);
 assert.equal(token.listenerCount, 0);
});

test('zero disables timer and cancellation aborts body reads', async t => {
 const url = await server(t, (_, res) => { res.writeHead(200); res.flushHeaders(); });
 const { r, token } = request(t, 0);
 const response = await r.fetch(url, {});
 await delay(180);
 assert.equal(r.timer, undefined);
 assert.equal(r.error, undefined);
 const reading = response.text();
 token.cancel();
 await assert.rejects(reading, { name: 'AbortError' });
 r.dispose();
 assert.equal(token.listenerCount, 0);
});

test('pre-cancelled requests and network failures clean up', async t => {
 const { r, token } = request(t);
 token.cancel();
 await assert.rejects(r.fetch('http://127.0.0.1:1', {}), { name: 'AbortError' });
 r.dispose();
 assert.equal(r.timer, undefined);
 assert.equal(token.listenerCount, 0);
 const other = request(t);
 await assert.rejects(other.r.fetch('http://127.0.0.1:1', {}));
 other.r.dispose();
 assert.equal(other.r.timer, undefined);
 assert.equal(other.token.listenerCount, 0);
});

for (const Driver of drivers) {
 test(`${Driver.name}: stalled SSE emits exactly one localized error and no completion`, async t => {
  const url = await server(t, (_, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': heartbeat\n\n'); });
  const token = cancellation();
  const errors = []; let done = 0;
  await new Driver().streamChatCompletion({
   requestIdleTimeoutSeconds: 0.15,
   provider: { id: 'p', name: 'p', baseUrl: url },
   model: { id: 'test', maxOutputTokens: 100, capabilities: { thinking: false } },
   messages: [{ role: 'user', content: 'hello' }], apiKey: 'test', thinkingEffort: 'none',
  }, { onContent() {}, onThinking() {}, onToolCall() {}, onDone() { done++; }, onError(err) { errors.push(err); } }, token);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, 'RequestIdleTimeoutError');
  assert.match(errors[0].message, /提供商连续 0.15 秒/);
  assert.equal(done, 0);
  assert.equal(token.listenerCount, 0);
 });
}


test('provider editor saves overrides, clears inheritance, and rejects invalid drafts before posting', () => {
 const ts = require('typescript');
 const fs = require('node:fs');
 const vm = require('node:vm');
 const messages = [];
 const source = fs.readFileSync(require('node:path').join(__dirname, '../src/webview/ui/main.ts'), 'utf8');
 const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
 const exports = {};
 const template = (strings, ...values) => ({ strings, values });
 vm.runInNewContext(compiled, {
  exports, structuredClone,
  acquireVsCodeApi: () => ({ postMessage: msg => messages.push(structuredClone(msg)) }),
  require: id => {
   if (id === 'lit') return { LitElement: class { requestUpdate() {} }, html: template, css: template };
   if (id === 'lit/decorators.js') return { customElement: () => target => target, property: () => () => {}, state: () => () => {} };
   if (id === '../../requestTimeout') return require('../out/requestTimeout');
   return {};
  },
 });
 const app = new exports.CopilotCustomProviderApp();
 const provider = { id: 'p', name: 'p', models: [], requestIdleTimeoutSeconds: 600 };
 app.providers = [provider];
 app.selectProvider('p');
 for (const value of ['-1', '0.5', '2147484', 'NaN']) {
  app.idleTimeoutDraft = { id: 'p', value, invalid: false };
  app.save();
  assert.equal(messages.length, 0);
 }
 app.idleTimeoutDraft = { id: 'p', value: '', invalid: true }; // native number input badInput
 app.save(); assert.equal(messages.length, 0);
 app.idleTimeoutDraft = { id: 'p', value: '0', invalid: false };
 app.save(); assert.equal(messages.at(-1).provider.requestIdleTimeoutSeconds, 0);
 app.idleTimeoutDraft = { id: 'p', value: '42', invalid: false };
 app.save(); assert.equal(messages.at(-1).provider.requestIdleTimeoutSeconds, 42);
 app.idleTimeoutDraft = { id: 'p', value: '', invalid: false };
 app.save(); assert.equal(Object.hasOwn(messages.at(-1).provider, 'requestIdleTimeoutSeconds'), false);
 app.selectProvider('p'); assert.equal(app.idleTimeoutDraft, undefined);
});

test('English and Chinese localization keys stay aligned', () => {
 const en = require('../package.nls.json');
 const zh = require('../package.nls.zh-cn.json');
 assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});
