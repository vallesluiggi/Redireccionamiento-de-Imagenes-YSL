// src/utils/uuid.js
function generateTimestampedRandomString(length = 6) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, length + 2);
    return `${timestamp}-${random}`;
}

module.exports = {
  generateTimestampedRandomString
};