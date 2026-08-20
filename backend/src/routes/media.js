var express = require('express');
var axios = require('axios');
var config = require('../config');
var router = express.Router();

var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

router.get('/:messageId', function (req, res) {
  var url = config.evoApiUrl + '/chat/getBase64FromMediaMessage/' + config.evoInstance;

  axios.post(url,
    { message: { key: { id: req.params.messageId } } },
    { headers: { apikey: config.evoApiKey, 'Content-Type': 'application/json' }, timeout: 30000 }
  )
    .then(function (response) {
      var body = response.data || {};
      var b64 = body.base64 || body.data;
      if (!b64) return res.status(404).json({ error: 'No media data' });

      // Evolution reports the real mimetype; sending everything as JPEG made
      // PNG and WebP attachments decode as garbage on the client.
      var mimetype = body.mimetype || '';
      var comma = b64.indexOf(',');
      if (comma !== -1) {
        var prefix = b64.substring(0, comma);
        var match = /^data:([^;]+)/.exec(prefix);
        if (match && !mimetype) mimetype = match[1];
        b64 = b64.substring(comma + 1);
      }
      if (ALLOWED_TYPES.indexOf(mimetype) === -1) mimetype = 'image/jpeg';

      var buffer = Buffer.from(b64, 'base64');
      res.set('Content-Type', mimetype);
      res.set('Content-Length', String(buffer.length));
      res.set('Cache-Control', 'private, max-age=86400');
      res.send(buffer);
    })
    .catch(function (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ error: 'Media not found' });
      }
      console.error('Media fetch failed: ' + err.message);
      res.status(502).json({ error: 'Failed to fetch media' });
    });
});

module.exports = router;
