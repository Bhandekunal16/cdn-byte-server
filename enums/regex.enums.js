const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,([\s\S]*)$/;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const gmailRegex = /^[^\s@]+@gmail\.com$/i;

function header() {
  return new Headers({ "Content-Type": "application/json" });
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function validateEmail(email) {
  return gmailRegex.test(email);
}

function error(message, option) {
  return new Error(message, option);
}

module.exports = {
  DATA_URL_PATTERN,
  BASE64_PATTERN,
  gmailRegex,
};

module.exports = { header, normalizeEmail, validateEmail, error };
