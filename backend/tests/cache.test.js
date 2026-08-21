var test = require('node:test');
var assert = require('node:assert');
var cache = require('../src/cache');

function message(chatId, id, timestamp) {
  return {
    id: id,
    chatId: chatId,
    text: 'x',
    fromMe: false,
    timestamp: timestamp,
    type: 'text'
  };
}

test('each chat keeps only its newest messages', function () {
  cache.reset();
  for (var i = 0; i <= cache.MAX_MESSAGES_PER_CHAT; i++) {
    cache.upsertMessage(message('one', 'per-' + i, i));
  }
  var messages = cache.getMessages('one');
  assert.strictEqual(messages.length, cache.MAX_MESSAGES_PER_CHAT);
  assert.strictEqual(messages[0].id, 'per-1');
});

test('the least recently used chat is evicted at the global chat limit', function () {
  cache.reset();
  for (var i = 0; i <= cache.MAX_CHATS; i++) {
    cache.upsertMessage(message('chat-' + i, 'chat-message-' + i, i));
  }
  assert.strictEqual(cache.getChats().length, cache.MAX_CHATS);
  assert.strictEqual(cache.getChatEntry('chat-0'), null);
});

test('the cache stays below its global message limit', function () {
  cache.reset();
  var id = 0;
  for (var chat = 0; chat < 11; chat++) {
    for (var i = 0; i < cache.MAX_MESSAGES_PER_CHAT; i++) {
      cache.upsertMessage(message('bulk-' + chat, 'bulk-message-' + id, id));
      id++;
    }
  }
  var chats = cache.getChats();
  var count = chats.reduce(function (sum, entry) {
    return sum + cache.getMessages(entry.id).length;
  }, 0);
  assert.ok(count <= cache.MAX_TOTAL_MESSAGES);
  assert.strictEqual(cache.getChatEntry('bulk-0'), null);
});

test('prototype-like chat and message ids are stored as ordinary keys', function () {
  cache.reset();
  cache.upsertMessage(message('__proto__', '__proto__', 1));
  assert.strictEqual(cache.getChatEntry('__proto__').id, '__proto__');
  assert.strictEqual(cache.getMessages('__proto__').length, 1);
  assert.strictEqual(Object.prototype.id, undefined);
});
