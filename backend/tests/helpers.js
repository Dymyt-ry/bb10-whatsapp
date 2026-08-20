// Every test needs the environment in place before config.js is required,
// since it validates and exits on anything missing.
process.env.EVO_API_URL = process.env.EVO_API_URL || 'http://127.0.0.1:9';
process.env.EVO_INSTANCE_NAME = process.env.EVO_INSTANCE_NAME || 'test';
process.env.EVO_API_KEY = process.env.EVO_API_KEY || 'test-evo-key';
process.env.AUTH_TOKEN = process.env.AUTH_TOKEN || 'test-token-0123456789';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret';

var app = require('../src/index');

var server = null;
var base = null;

function start() {
  if (base) return Promise.resolve(base);
  return new Promise(function (resolve) {
    server = app.listen(0, '127.0.0.1', function () {
      base = 'http://127.0.0.1:' + server.address().port;
      resolve(base);
    });
  });
}

function stop() {
  if (server) server.close();
  server = null;
  base = null;
}

function call(path, options) {
  options = options || {};
  var headers = Object.assign({}, options.headers);
  if (options.auth !== false) headers['x-api-token'] = process.env.AUTH_TOKEN;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  return fetch(base + path, { method: options.method || 'GET', headers: headers, body: options.body });
}

function baseUrl() { return base; }

module.exports = {
  start: start, stop: stop, call: call,
  baseUrl: baseUrl, token: process.env.AUTH_TOKEN
};
