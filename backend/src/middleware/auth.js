var crypto = require('crypto');

var expected = process.env.AUTH_TOKEN || '';

// A plain !== leaks the length of the matching prefix through timing. The
// tokens are short enough that it is cheap to compare them properly.
function tokensMatch(candidate) {
  var a = Buffer.from(String(candidate));
  var b = Buffer.from(expected);
  if (a.length !== b.length) {
    // timingSafeEqual throws on a length mismatch, so hash both sides to a
    // fixed width first and compare those instead.
    a = crypto.createHash('sha256').update(a).digest();
    b = crypto.createHash('sha256').update(b).digest();
  }
  return crypto.timingSafeEqual(a, b);
}

function authMiddleware(req, res, next) {
  var token = req.headers['x-api-token'];

  if (!token || !tokensMatch(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = authMiddleware;
