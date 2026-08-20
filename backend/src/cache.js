// In-memory message store, populated by Evolution API webhook events.
//
// There is no persistence: the cache is rebuilt from incoming webhooks after a
// restart, which is fine for a client that only shows recent conversation.
// It is bounded, though — an earlier version grew without limit and would
// eventually take the process down on a small VPS.

var MAX_MESSAGES_PER_CHAT = 500;
var MAX_SEEN_IDS = 20000;
var UNNAMED_GROUP = 'Group';

var chats = {};       // chatId → chat record
var messages = {};    // chatId → [message, ...] oldest first
var seenIds = [];     // insertion-ordered message ids, for dedup
var seenIdSet = {};   // messageId → true

function markSeen(id) {
  if (seenIdSet[id]) return false;
  seenIdSet[id] = true;
  seenIds.push(id);
  if (seenIds.length > MAX_SEEN_IDS) {
    var evicted = seenIds.splice(0, seenIds.length - MAX_SEEN_IDS);
    for (var i = 0; i < evicted.length; i++) {
      delete seenIdSet[evicted[i]];
    }
  }
  return true;
}

function getChatName(msg, existingChat) {
  if (existingChat && existingChat.customName) return existingChat.customName;
  if (msg.chatId.indexOf('@g.us') !== -1) {
    return (existingChat && existingChat.name) || UNNAMED_GROUP;
  }
  // An incoming message carries the counterparty's own display name.
  if (!msg.fromMe && msg.pushName) return msg.pushName;
  return (existingChat && existingChat.name) || msg.chatId;
}

function upsertMessage(msg) {
  if (!msg || !msg.id || !msg.chatId) return;
  if (!markSeen(msg.id)) return;

  var chatId = msg.chatId;
  var existing = chats[chatId];

  chats[chatId] = {
    id: chatId,
    name: getChatName(msg, existing),
    customName: (existing && existing.customName) || null,
    lastMessage: msg.type === 'image' ? (msg.text || '[Image]') : (msg.text || ''),
    timestamp: msg.timestamp,
    unreadCount: (existing && existing.unreadCount) || 0
  };

  if (!msg.fromMe) {
    chats[chatId].unreadCount++;
  }

  if (!messages[chatId]) messages[chatId] = [];

  var notifyText = null;
  if (!msg.fromMe) {
    notifyText = (msg.pushName || msg.chatId) + ': ' + (msg.text || '[Media]');
  }

  messages[chatId].push({
    id: msg.id,
    text: msg.text || '',
    fromMe: msg.fromMe,
    sender: msg.pushName || null,
    timestamp: msg.timestamp,
    notify: !msg.fromMe,
    notifyText: notifyText,
    type: msg.type || 'text',
    mediaId: msg.mediaId || null
  });

  if (messages[chatId].length > MAX_MESSAGES_PER_CHAT) {
    messages[chatId].splice(0, messages[chatId].length - MAX_MESSAGES_PER_CHAT);
  }
}

function renameChat(chatId, customName) {
  if (!chats[chatId]) {
    chats[chatId] = {
      id: chatId, name: customName, customName: customName,
      lastMessage: '', timestamp: 0, unreadCount: 0
    };
  } else {
    chats[chatId].customName = customName;
    chats[chatId].name = customName;
  }
}

function getChats() {
  return Object.keys(chats)
    .map(function (id) { return chats[id]; })
    .sort(function (a, b) { return b.timestamp - a.timestamp; });
}

function getMessages(chatId) {
  return messages[chatId] || [];
}

function addSentMessage(chatId, text, messageId) {
  var ts = Math.floor(Date.now() / 1000);
  var msg = {
    id: messageId || ('sent_' + ts + '_' + Math.random().toString(36).slice(2, 8)),
    text: text,
    fromMe: true,
    sender: null,
    timestamp: ts,
    chatId: chatId,
    type: 'text',
    mediaId: null
  };
  upsertMessage(msg);
  return msg;
}

function resolveLid(lid) {
  return lidToPhone[lid] || null;
}

var lidToPhone = {};

function storeLidMapping(lid, phoneChatId) {
  lidToPhone[lid] = phoneChatId;
}

function getChatEntry(chatId) {
  return chats[chatId] || null;
}

function updateGroupName(chatId, name) {
  if (chats[chatId] && !chats[chatId].customName) {
    chats[chatId].name = name;
  }
}

function clearUnread(chatId) {
  if (chats[chatId]) chats[chatId].unreadCount = 0;
}

function addReaction(chatId, targetMsgId, emoji) {
  var msgs = messages[chatId];
  if (!msgs) return;
  for (var i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].id === targetMsgId) {
      msgs[i].reaction = emoji && emoji.length > 0 ? emoji : null;
      return;
    }
  }
}

/** Test seam: drops every chat and message. */
function reset() {
  chats = {};
  messages = {};
  seenIds = [];
  seenIdSet = {};
  lidToPhone = {};
}

module.exports = {
  UNNAMED_GROUP: UNNAMED_GROUP,
  MAX_MESSAGES_PER_CHAT: MAX_MESSAGES_PER_CHAT,
  upsertMessage: upsertMessage,
  getChats: getChats,
  getMessages: getMessages,
  addSentMessage: addSentMessage,
  renameChat: renameChat,
  resolveLid: resolveLid,
  storeLidMapping: storeLidMapping,
  getChatEntry: getChatEntry,
  updateGroupName: updateGroupName,
  clearUnread: clearUnread,
  addReaction: addReaction,
  reset: reset
};
