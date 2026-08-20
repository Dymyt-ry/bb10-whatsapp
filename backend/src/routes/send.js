var express = require('express');
var axios = require('axios');
var cache = require('../cache');
var config = require('../config');
var jid = require('../jid');
var router = express.Router();

var MAX_TEXT_LENGTH = 4096;

router.post('/', function (req, res) {
  var chatId = req.body && req.body.chatId;
  var text = req.body && req.body.text;

  if (typeof chatId !== 'string' || typeof text !== 'string') {
    return res.status(400).json({ error: 'chatId and text are required' });
  }

  var cleanChatId = chatId.trim();
  var cleanText = text.trim();

  if (!cleanChatId || !cleanText) {
    return res.status(400).json({ error: 'chatId and text must not be empty' });
  }
  if (cleanText.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({ error: 'text is too long' });
  }

  var url = config.evoApiUrl + '/message/sendText/' + config.evoInstance;

  axios.post(url, {
    number: jid.toRecipient(cleanChatId),
    text: cleanText
  }, {
    headers: { apikey: config.evoApiKey, 'Content-Type': 'application/json' },
    timeout: 30000
  })
    .then(function (response) {
      var messageId = response.data && response.data.key ? response.data.key.id : null;
      var msg = cache.addSentMessage(cleanChatId, cleanText, messageId);
      res.json({ sent: true, message: msg });
    })
    .catch(function (err) {
      // Deliberately no chat id and no message text: this is somebody's
      // private conversation, and server logs are not the place for it.
      var status = err.response ? err.response.status : null;
      console.error('sendText failed' + (status ? ' (HTTP ' + status + ')' : '') + ': ' + err.message);
      res.status(502).json({ error: 'Failed to send message via Evolution API' });
    });
});

module.exports = router;
