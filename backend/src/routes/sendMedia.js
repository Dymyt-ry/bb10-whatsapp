var express = require('express');
var axios = require('axios');
var multer = require('multer');
var config = require('../config');
var jid = require('../jid');
var router = express.Router();

var MAX_BYTES = 5 * 1024 * 1024;
var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: function (req, file, cb) {
    // The endpoint forwards everything as mediatype "image"; anything else
    // would arrive in the chat as a broken attachment.
    if (ALLOWED_TYPES.indexOf(file.mimetype) === -1) {
      return cb(new Error('Unsupported image type'));
    }
    cb(null, true);
  }
});

router.post('/', function (req, res) {
  upload.single('image')(req, res, function (err) {
    if (err) {
      var tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400)
        .json({ error: tooBig ? 'Image is larger than 5 MB' : err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'image file is required' });

    var number = req.body && req.body.number;
    if (typeof number !== 'string' || !number.trim()) {
      return res.status(400).json({ error: 'number is required' });
    }

    var url = config.evoApiUrl + '/message/sendMedia/' + config.evoInstance;

    axios.post(url, {
      number: jid.toRecipient(number.trim()),
      mediatype: 'image',
      mimetype: req.file.mimetype,
      media: req.file.buffer.toString('base64')
    }, {
      headers: { apikey: config.evoApiKey, 'Content-Type': 'application/json' },
      timeout: 60000
    })
      .then(function (response) {
        var messageId = response.data && response.data.key ? response.data.key.id : null;
        res.json({ success: true, messageId: messageId });
      })
      .catch(function (axiosErr) {
        console.error('sendMedia failed: ' + axiosErr.message);
        res.status(502).json({ error: 'Failed to send media' });
      });
  });
});

module.exports = router;
