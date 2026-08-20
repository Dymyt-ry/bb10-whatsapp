var express = require('express');
var axios = require('axios');
var cache = require('../cache');
var config = require('../config');
var router = express.Router();

function stripSuffix(jid) {
  if (!jid) return jid;
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '');
}

// Evolution API cannot attach custom headers to its webhook, so the shared
// secret goes in the path: POST /webhook/<secret>. Without WEBHOOK_SECRET the
// bare /webhook path stays open, which config.js warns about at startup.
function verifySecret(req, res, next) {
  if (!config.webhookSecret) return next();
  if (req.params.secret === config.webhookSecret) return next();
  return res.status(404).json({ error: 'Not found' });
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

router.post('/', verifySecret, handleEvent);
router.post('/:secret', verifySecret, handleEvent);

function processReaction(reaction) {
  var key = reaction.key;
  if (!key) return;
  // Same *Alt preference as processMessage. Without it a reaction arriving on
  // an @lid chat was filed under a different chatId than the message it
  // belonged to, and never showed up.
  var chatId = stripSuffix(key.remoteJidAlt || key.remoteJid);
  var targetId = key.id;
  if (targetId && chatId) {
    cache.addReaction(chatId, targetId, reaction.text || '');
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
      text = data.message.imageMessage.caption || '';
    } else {
      text = data.message.conversation
        || (data.message.extendedTextMessage && data.message.extendedTextMessage.text)
        || '';
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

  cache.upsertMessage({
    id: messageId,
    chatId: chatId,
    fromMe: key.fromMe || false,
    pushName: data.pushName || null,
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
