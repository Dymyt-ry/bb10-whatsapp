require('dotenv').config();

var express = require('express');
var cors = require('cors');
var config = require('./config');
var authMiddleware = require('./middleware/auth');
var webhookRouter = require('./routes/webhook');
var chatsRouter = require('./routes/chats');
var chatRouter = require('./routes/chat');
var sendRouter = require('./routes/send');
var mediaRouter = require('./routes/media');
var sendMediaRouter = require('./routes/sendMedia');
var reactionRouter = require('./routes/reaction');

var app = express();

app.disable('x-powered-by');

// The Android client sends no Origin header, so CORS is only relevant to a
// browser. Default to refusing browsers entirely rather than to allowing all.
app.use(cors(config.corsOrigin ? { origin: config.corsOrigin } : { origin: false }));

// Webhook payloads are JSON metadata, not media: webhookBase64 must stay off.
app.use(express.json({ limit: '512kb' }));

// Unauthenticated by design — Evolution API cannot send custom headers, so the
// shared secret rides in the path instead.
app.use('/webhook', webhookRouter);

app.use('/chats', authMiddleware, chatsRouter);
app.use('/chat', authMiddleware, chatRouter);
app.use('/send', authMiddleware, sendRouter);
app.use('/api/media', authMiddleware, mediaRouter);
app.use('/api/messages/sendMedia', authMiddleware, sendMediaRouter);
app.use('/api/messages/reaction', authMiddleware, reactionRouter);

app.get('/status', function (req, res) {
  res.json({ status: 'ok' });
});

app.use(function (req, res) {
  res.status(404).json({ error: 'Not found' });
});

// Without this, a malformed body makes Express return an HTML page with a
// stack trace in it.
app.use(function (err, req, res, next) {
  if (res.headersSent) return next(err);
  console.error('Unhandled error on ' + req.method + ' ' + req.path + ': ' + err.message);
  res.status(err.status || 500).json({ error: 'Internal error' });
});

if (require.main === module) {
  app.listen(config.port, function () {
    console.log('BBWA backend listening on port ' + config.port);
  });
}

module.exports = app;
