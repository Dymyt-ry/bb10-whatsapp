var test = require('node:test');
var assert = require('node:assert');
var h = require('./helpers');
var cache = require('../src/cache');

test.before(function () { return h.start(); });
test.after(function () { h.stop(); });

test('status is public', async function () {
  var res = await h.call('/status', { auth: false });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { status: 'ok' });
});

test('protected routes reject a missing token', async function () {
  for (var path of ['/chats', '/chat/123', '/send']) {
    var res = await h.call(path, { auth: false });
    assert.strictEqual(res.status, 401, path + ' should be 401');
  }
});

test('protected routes reject a wrong token', async function () {
  var res = await h.call('/chats', { auth: false, headers: { 'x-api-token': 'nope' } });
  assert.strictEqual(res.status, 401);
});

test('a token that is a prefix of the real one is rejected', async function () {
  var res = await h.call('/chats', {
    auth: false, headers: { 'x-api-token': h.token.slice(0, -1) }
  });
  assert.strictEqual(res.status, 401);
});

test('the webhook refuses posts without the shared secret', async function () {
  var res = await h.call('/webhook', { auth: false, method: 'POST', json: { event: 'x' } });
  assert.strictEqual(res.status, 404);

  var wrong = await h.call('/webhook/guessed', { auth: false, method: 'POST', json: { event: 'x' } });
  assert.strictEqual(wrong.status, 404);
});

test('a webhook message reaches the chat list', async function () {
  cache.reset();
  var res = await h.call('/webhook/' + process.env.WEBHOOK_SECRET, {
    auth: false,
    method: 'POST',
    json: {
      event: 'messages.upsert',
      data: {
        key: { id: 'MSG1', remoteJid: '111@s.whatsapp.net', fromMe: false },
        pushName: 'Alice',
        message: { conversation: 'hello' },
        messageTimestamp: 1700000000
      }
    }
  });
  assert.strictEqual(res.status, 200);

  var chats = await (await h.call('/chats')).json();
  assert.strictEqual(chats.length, 1);
  assert.strictEqual(chats[0].id, '111');
  assert.strictEqual(chats[0].name, 'Alice');
  assert.strictEqual(chats[0].unreadCount, 1);

  var messages = await (await h.call('/chat/111')).json();
  assert.strictEqual(messages[0].text, 'hello');
});

test('opening a chat clears its unread badge', async function () {
  var chats = await (await h.call('/chats')).json();
  assert.strictEqual(chats[0].unreadCount, 0);
});

test('an @lid message is filed under the real number from remoteJidAlt', async function () {
  cache.reset();
  await h.call('/webhook/' + process.env.WEBHOOK_SECRET, {
    auth: false,
    method: 'POST',
    json: {
      event: 'messages.upsert',
      data: {
        key: { id: 'MSG2', remoteJid: '999@lid', remoteJidAlt: '222@s.whatsapp.net', fromMe: false },
        message: { conversation: 'from a lid chat' },
        messageTimestamp: 1700000001
      }
    }
  });
  var chats = await (await h.call('/chats')).json();
  assert.strictEqual(chats[0].id, '222');
});

test('a reaction on an @lid chat lands on the message it belongs to', async function () {
  cache.reset();
  var secret = process.env.WEBHOOK_SECRET;
  await h.call('/webhook/' + secret, {
    auth: false, method: 'POST',
    json: {
      event: 'messages.upsert',
      data: {
        key: { id: 'MSG3', remoteJid: '999@lid', remoteJidAlt: '333@s.whatsapp.net', fromMe: false },
        message: { conversation: 'react to me' },
        messageTimestamp: 1700000002
      }
    }
  });
  await h.call('/webhook/' + secret, {
    auth: false, method: 'POST',
    json: {
      event: 'messages.upsert',
      data: {
        message: {
          reactionMessage: {
            key: { id: 'MSG3', remoteJid: '999@lid', remoteJidAlt: '333@s.whatsapp.net' },
            text: '❤️'
          }
        }
      }
    }
  });
  var messages = await (await h.call('/chat/333')).json();
  assert.strictEqual(messages[0].reaction, '❤️');
});

test('send rejects malformed bodies', async function () {
  var cases = [{}, { chatId: '111' }, { text: 'hi' }, { chatId: '111', text: '   ' }, { chatId: 5, text: 'hi' }];
  for (var body of cases) {
    var res = await h.call('/send', { method: 'POST', json: body });
    assert.strictEqual(res.status, 400, JSON.stringify(body) + ' should be 400');
  }
});

test('send rejects an over-long message', async function () {
  var res = await h.call('/send', { method: 'POST', json: { chatId: '111', text: 'x'.repeat(5000) } });
  assert.strictEqual(res.status, 413);
});

test('rename requires a name and caps its length', async function () {
  cache.reset();
  var bad = await h.call('/chat/111/rename', { method: 'POST', json: {} });
  assert.strictEqual(bad.status, 400);

  var ok = await h.call('/chat/111/rename', { method: 'POST', json: { name: 'y'.repeat(500) } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await ok.json()).name.length, 128);
});

test('an unknown path returns JSON, not an HTML error page', async function () {
  var res = await h.call('/nope');
  assert.strictEqual(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
});

test('malformed JSON does not leak a stack trace', async function () {
  var res = await fetch(h.baseUrl() + '/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-token': h.token },
    body: '{"chatId": '
  });
  assert.strictEqual(res.status, 400);
  var text = await res.text();
  assert.ok(!/at .*\.js:\d+/.test(text), 'response contained a stack trace: ' + text);
});
