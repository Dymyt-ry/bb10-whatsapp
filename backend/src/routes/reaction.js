var express = require('express');
var axios = require('axios');
var cache = require('../cache');
var config = require('../config');
var jid = require('../jid');
var router = express.Router();

router.post('/', function (req, res) {
  var body = req.body || {};
  var chatId = body.chatId;
  var messageId = body.messageId;
  var emoji = typeof body.emoji === 'string' ? body.emoji : '';
  var originalFromMe = body.originalFromMe === true;

  if (typeof chatId !== 'string' || typeof messageId !== 'string' || !chatId || !messageId) {
    return res.status(400).json({ error: 'chatId and messageId are required' });
  }

  var url = config.evoApiUrl + '/message/sendReaction/' + config.evoInstance;

  axios.post(url, {
    key: { remoteJid: jid.toRemoteJid(chatId), fromMe: originalFromMe, id: messageId },
    reaction: emoji
  }, {
    headers: { apikey: config.evoApiKey, 'Content-Type': 'application/json' },
    timeout: 15000
  })
    .then(function () {
      // Reflect it locally too: the webhook echo for our own reaction is not
      // guaranteed, and the client already drew it optimistically.
      cache.addReaction(chatId, messageId, emoji);
      res.json({ success: true });
    })
    .catch(function (err) {
      console.error('sendReaction failed: ' + err.message);
      res.status(502).json({ error: 'Failed to send reaction' });
    });
});

module.exports = router;
