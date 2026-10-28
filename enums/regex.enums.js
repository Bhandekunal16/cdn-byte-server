const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,([\s\S]*)$/;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const gmailRegex = /^[^\s@]+@gmail\.com$/i;

const registerQuery = `CREATE ( u:User { id: randomUUID(), email: $email, passwordHash: $passwordHash, createdAt: datetime(), updatedAt: datetime(), role : "user"})
      RETURN u {.id, .email, .createdAt, .role } AS user
      `;

const loginQuery = ` MATCH (u:User {email: $email})
      RETURN u {.id, .email, .passwordHash, .role } AS user
      LIMIT 1`;

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
  registerQuery,
  loginQuery,
};

module.exports = { header, normalizeEmail, validateEmail, error };
