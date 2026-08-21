var test = require('node:test');
var assert = require('node:assert');
var h = require('./helpers');
var cache = require('../src/cache');
var childProcess = require('node:child_process');

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

test('the backend refuses to start without WEBHOOK_SECRET', function () {
  var env = Object.assign({}, process.env);
  delete env.WEBHOOK_SECRET;
  var result = childProcess.spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: require('node:path').join(__dirname, '..'),
    env: env,
    encoding: 'utf8'
  });
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /WEBHOOK_SECRET/);
});

function loadConfigWithSecret(secret) {
  var env = Object.assign({}, process.env, { WEBHOOK_SECRET: secret });
  var result = childProcess.spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: require('node:path').join(__dirname, '..'),
    env: env,
    encoding: 'utf8'
  });
  return result;
}

test('the backend refuses a short WEBHOOK_SECRET', function () {
  var result = loadConfigWithSecret('too-short');
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /WEBHOOK_SECRET must be at least 16 characters/);
});

test('the backend refuses route-unsafe WEBHOOK_SECRET characters', function () {
  var invalid = [
    'abcdefghijklmnop/',
    'abcdefghijklmnop?',
    'abcdefghijklmnop#',
    'abcdefghijklmnop ',
    'abcdefghijklmnop\n',
    'abcdefghijklmnop\r',
    'abcdefghijklmnopé'
  ];
  invalid.forEach(function (secret) {
    var result = loadConfigWithSecret(secret);
    assert.strictEqual(result.status, 1, JSON.stringify(secret) + ' should be rejected');
    assert.match(result.stderr, /only ASCII letters, digits, underscores, or hyphens/);
  });
});

test('the backend accepts route-safe WEBHOOK_SECRET characters', function () {
  var result = loadConfigWithSecret('AZaz09_-route_safe');
  assert.strictEqual(result.status, 0, result.stderr);
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

test('polling a chat does not clear its unread badge', async function () {
  var chats = await (await h.call('/chats')).json();
  assert.strictEqual(chats[0].unreadCount, 1);
});

test('the explicit read endpoint clears the unread badge', async function () {
  var marked = await h.call('/chat/111/read', { method: 'POST', json: {} });
  assert.strictEqual(marked.status, 200);
  var chats = await (await h.call('/chats')).json();
  assert.strictEqual(chats[0].unreadCount, 0);
});

test('webhook text is capped before it enters the cache', async function () {
  cache.reset();
  await h.call('/webhook/' + process.env.WEBHOOK_SECRET, {
    auth: false,
    method: 'POST',
    json: {
      event: 'messages.upsert',
      data: {
        key: { id: 'LONG', remoteJid: '111@s.whatsapp.net', fromMe: false },
        message: { conversation: 'x'.repeat(5000) }
      }
    }
  });
  var messages = await (await h.call('/chat/111')).json();
  assert.strictEqual(messages[0].text.length, 4096);
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

test('malformed webhook JSON does not put its secret path in logs', async function () {
  var secret = process.env.WEBHOOK_SECRET;
  var lines = [];
  var originalError = console.error;
  console.error = function (line) { lines.push(String(line)); };
  try {
    var res = await fetch(h.baseUrl() + '/webhook/' + secret, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"event": '
    });
    assert.strictEqual(res.status, 400);
  } finally {
    console.error = originalError;
  }
  assert.ok(lines.some(function (line) { return line.indexOf('/webhook/[redacted]') !== -1; }));
  assert.ok(lines.every(function (line) { return line.indexOf(secret) === -1; }));
});
