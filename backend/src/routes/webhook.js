var express = require('express');
var axios = require('axios');
var cache = require('../cache');
var config = require('../config');
var router = express.Router();
var MAX_WEBHOOK_TEXT_LENGTH = 4096;
var MAX_IDENTIFIER_LENGTH = 256;
var MAX_NAME_LENGTH = 256;

function stripSuffix(jid) {
  if (!jid) return jid;
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '');
}

// Evolution API cannot attach custom headers to its webhook, so the required
// shared secret goes in the path: POST /webhook/<secret>.
function verifySecret(req, res, next) {
  if (req.params.secret === config.webhookSecret) return next();
  return res.status(404).json({ error: 'Not found' });
}

function boundedText(value) {
  return typeof value === 'string' ? value.slice(0, MAX_WEBHOOK_TEXT_LENGTH) : '';
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH;
}

function handleEvent(req, res) {
  var event = req.body;

  if (event && event.event === 'messages.upsert' && event.data) {
    var data = event.data;
    if (data.message && data.message.reactionMessage) {
      processReaction(data.message.reactionMessage);
    } else {
      processMessage(data);
    }
  }

  res.status(200).json({ received: true });
}

router.post('/:secret', verifySecret, handleEvent);

function processReaction(reaction) {
  var key = reaction.key;
  if (!key) return;
  // Same *Alt preference as processMessage. Without it a reaction arriving on
  // an @lid chat was filed under a different chatId than the message it
  // belonged to, and never showed up.
  var chatId = stripSuffix(key.remoteJidAlt || key.remoteJid);
  var targetId = key.id;
  if (validIdentifier(targetId) && validIdentifier(chatId)) {
    cache.addReaction(chatId, targetId, boundedText(reaction.text));
  }
}

function processMessage(data) {
  if (!data.key) return;
  var key = data.key;
  var messageId = key.id;
  var text = '';
  var type = 'text';
  var mediaId = null;

  if (data.message) {
    if (data.message.imageMessage) {
      type = 'image';
      mediaId = messageId;
      text = boundedText(data.message.imageMessage.caption);
    } else {
      text = boundedText(data.message.conversation
        || (data.message.extendedTextMessage && data.message.extendedTextMessage.text)
        || '');
    }
  }

  var timestamp = data.messageTimestamp;
  if (typeof timestamp === 'string') {
    timestamp = parseInt(timestamp, 10);
  }
  timestamp = timestamp || Math.floor(Date.now() / 1000);

  // v2 carries the real phone number in the *Alt fields; remoteJid may be an
  // @lid pseudonym.
  var rawChatId = key.remoteJidAlt || key.remoteJid;
  var chatId = stripSuffix(rawChatId);
  if (!validIdentifier(messageId) || !validIdentifier(chatId)) return;

  cache.upsertMessage({
    id: messageId,
    chatId: chatId,
    fromMe: key.fromMe || false,
    pushName: typeof data.pushName === 'string'
      ? data.pushName.slice(0, MAX_NAME_LENGTH) : null,
    text: text,
    timestamp: timestamp,
    type: type,
    mediaId: mediaId
  });

  if (rawChatId && rawChatId.indexOf('@g.us') !== -1) {
    maybeFetchGroupName(rawChatId, chatId);
  }
}

function maybeFetchGroupName(rawChatId, chatId) {
  var entry = cache.getChatEntry(chatId);
  if (entry && entry.name && entry.name !== cache.UNNAMED_GROUP) return;

  axios.get(
    config.evoApiUrl + '/group/findGroupInfos/' + config.evoInstance,
    { params: { groupJid: rawChatId }, headers: { apikey: config.evoApiKey }, timeout: 10000 }
  ).then(function (response) {
    if (response.data && response.data.subject) {
      cache.updateGroupName(chatId, response.data.subject);
    }
  }).catch(function (err) {
    console.error('Group name lookup failed: ' + err.message);
  });
}

module.exports = router;
