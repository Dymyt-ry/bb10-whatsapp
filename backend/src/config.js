// Fail at startup rather than serving 401s to a confused user, or worse,
// forwarding requests to Evolution API without a key.

var REQUIRED = [
  'EVO_API_URL', 'EVO_INSTANCE_NAME', 'EVO_API_KEY', 'AUTH_TOKEN',
  'WEBHOOK_SECRET'
];
var WEBHOOK_SECRET_FORBIDDEN = /[^A-Za-z0-9_-]/;

function load() {
  var missing = REQUIRED.filter(function (name) {
    return !process.env[name];
  });

  if (missing.length > 0) {
    console.error('Missing required environment variables: ' + missing.join(', '));
    console.error('Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  if (process.env.AUTH_TOKEN.length < 16) {
    console.error('AUTH_TOKEN must be at least 16 characters.');
    process.exit(1);
  }

  if (process.env.WEBHOOK_SECRET.length < 16
      || WEBHOOK_SECRET_FORBIDDEN.test(process.env.WEBHOOK_SECRET)) {
    console.error(
      'WEBHOOK_SECRET must be at least 16 characters and contain only ' +
      'ASCII letters, digits, underscores, or hyphens.');
    process.exit(1);
  }

  return {
    evoApiUrl: process.env.EVO_API_URL.replace(/\/+$/, ''),
    evoInstance: process.env.EVO_INSTANCE_NAME,
    evoApiKey: process.env.EVO_API_KEY,
    webhookSecret: process.env.WEBHOOK_SECRET,
    corsOrigin: process.env.CORS_ORIGIN || null,
    port: parseInt(process.env.PORT, 10) || 3000
  };
}

module.exports = load();
