var express = require('express');
var cache = require('../cache');
var router = express.Router();

var MAX_NAME_LENGTH = 128;

router.get('/:id', function (req, res) {
  cache.clearUnread(req.params.id);
  res.json(cache.getMessages(req.params.id));
});

router.post('/:id/rename', function (req, res) {
  var name = req.body && req.body.name;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  var trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  cache.renameChat(req.params.id, trimmed);
  res.json({ renamed: true, chatId: req.params.id, name: trimmed });
});

module.exports = router;
