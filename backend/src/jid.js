// WhatsApp identifiers, in the two shapes this project deals with:
//
//   individual   4479111234@s.whatsapp.net   (or an @lid pseudonym)
//   group        120363000000000000@g.us
//
// The cache stores individual chats with the suffix stripped and groups with
// @g.us intact, so anything sent back out has to be put together again.

var GROUP_SUFFIX = '@g.us';

function isGroup(chatId) {
  return typeof chatId === 'string' && chatId.indexOf(GROUP_SUFFIX) !== -1;
}

/** The `number` field Evolution API expects when sending. */
function toRecipient(chatId) {
  if (isGroup(chatId)) return chatId;
  return chatId.replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '');
}

/**
 * A full JID for the `key.remoteJid` of a reaction. Group ids were previously
 * guessed from string length, which happens to work for E.164 numbers but
 * breaks on anything else; the suffix is the actual signal.
 */
function toRemoteJid(chatId) {
  if (isGroup(chatId)) return chatId;
  if (chatId.indexOf('@') !== -1) return chatId;
  return chatId + '@s.whatsapp.net';
}

module.exports = {
  isGroup: isGroup,
  toRecipient: toRecipient,
  toRemoteJid: toRemoteJid
};
