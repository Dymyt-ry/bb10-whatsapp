// The other suite proves the app answers the phone correctly. This one proves
// what it says to Evolution API: path, instance, apikey header and body shape.
// Those are the parts that silently broke across Evolution v1 → v2.

var test = require('node:test');
var assert = require('node:assert');
var http = require('node:http');

var received = [];
var stub = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString();
    var body = null;
    try { body = JSON.parse(raw); } catch (e) { body = raw; }
    received.push({ method: req.method, url: req.url, headers: req.headers, body: body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: { id: 'EVO_MSG_ID' } }));
  });
});

var app, server, base;

test.before(function () {
  return new Promise(function (resolve) {
    stub.listen(0, '127.0.0.1', function () {
      process.env.EVO_API_URL = 'http://127.0.0.1:' + stub.address().port;
      process.env.EVO_INSTANCE_NAME = 'bbwa-test';
      process.env.EVO_API_KEY = 'evo-key-under-test';
      process.env.AUTH_TOKEN = 'test-token-0123456789';
      process.env.WEBHOOK_SECRET = 'test-webhook-secret';

      app = require('../src/index');
      server = app.listen(0, '127.0.0.1', function () {
        base = 'http://127.0.0.1:' + server.address().port;
        resolve();
      });
    });
  });
});

test.after(function () {
  if (server) server.close();
  stub.close();
});

function post(path, body) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-token': process.env.AUTH_TOKEN },
    body: JSON.stringify(body)
  });
}

test('a text message reaches Evolution with the right path, key and body', async function () {
  received.length = 0;
  var res = await post('/send', { chatId: '447911123456', text: 'hello there' });
  assert.strictEqual(res.status, 200);

  assert.strictEqual(received.length, 1);
  var call = received[0];
  assert.strictEqual(call.method, 'POST');
  assert.strictEqual(call.url, '/message/sendText/bbwa-test');
  assert.strictEqual(call.headers.apikey, 'evo-key-under-test');
  assert.deepStrictEqual(call.body, { number: '447911123456', text: 'hello there' });

  // The id Evolution returns is what the cache stores, so the client can match
  // a later reaction to this message.
  var sent = await res.json();
  assert.strictEqual(sent.message.id, 'EVO_MSG_ID');
});

test('the @s.whatsapp.net suffix is stripped before sending', async function () {
  received.length = 0;
  await post('/send', { chatId: '447911123456@s.whatsapp.net', text: 'x' });
  assert.strictEqual(received[0].body.number, '447911123456');
});

test('an @lid chat id is stripped too', async function () {
  received.length = 0;
  await post('/send', { chatId: '99887766@lid', text: 'x' });
  assert.strictEqual(received[0].body.number, '99887766');
});

test('a group id keeps its @g.us suffix', async function () {
  received.length = 0;
  await post('/send', { chatId: '120363000000000000@g.us', text: 'x' });
  assert.strictEqual(received[0].body.number, '120363000000000000@g.us');
});

test('a message containing a backslash and a newline survives intact', async function () {
  received.length = 0;
  var awkward = 'path C:\\temp\\file "quoted"\nsecond line\ttabbed';
  var res = await post('/send', { chatId: '111', text: awkward });
  assert.strictEqual(res.status, 200);
  // Reaches Evolution byte for byte. The Android client used to build this
  // JSON by hand and escaped only double quotes, so a backslash produced a
  // malformed body and a 400 before it ever got here.
  assert.strictEqual(received[0].body.text, awkward);
});

test('a reaction is addressed with a full JID, by suffix rather than by length', async function () {
  received.length = 0;
  await post('/api/messages/reaction', {
    chatId: '447911123456', messageId: 'MSG9', emoji: '❤️', originalFromMe: false
  });
  var call = received[0];
  assert.strictEqual(call.url, '/message/sendReaction/bbwa-test');
  assert.strictEqual(call.body.key.remoteJid, '447911123456@s.whatsapp.net');
  assert.strictEqual(call.body.reaction, '❤️');

  received.length = 0;
  await post('/api/messages/reaction', {
    chatId: '120363000000000000@g.us', messageId: 'MSG9', emoji: '👍'
  });
  assert.strictEqual(received[0].body.key.remoteJid, '120363000000000000@g.us');
});

test('originalFromMe is only ever a boolean', async function () {
  received.length = 0;
  await post('/api/messages/reaction', {
    chatId: '111', messageId: 'M', emoji: '👍', originalFromMe: 'yes-please'
  });
  assert.strictEqual(received[0].body.key.fromMe, false);
});

test('the Evolution api key never leaks to the client', async function () {
  var res = await fetch(base + '/chats', { headers: { 'x-api-token': process.env.AUTH_TOKEN } });
  var text = await res.text();
  assert.ok(text.indexOf('evo-key-under-test') === -1);
});
