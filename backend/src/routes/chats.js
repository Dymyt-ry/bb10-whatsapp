var express = require('express');
var cache = require('../cache');
var router = express.Router();

router.get('/', function (req, res) {
  res.json(cache.getChats());
});

module.exports = router;
