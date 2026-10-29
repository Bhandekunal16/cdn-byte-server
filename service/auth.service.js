const { bcrypt } = require("../provider/dependency.map");
const { neo4jDriver } = require("../database/neo4j.service");
const { issueAccessToken } = require("./access-token.service");
const {
  normalizeEmail,
  validateEmail,
} = require("../enums/regex.enums");
const {
  neo4j,
  LOGIN_CONFIG,
  REGISTER_CONFIG,
} = require("../provider/config.map");

const { NEO4J_DATABASE: database } = neo4j;
const { LOGIN_ERROR } = LOGIN_CONFIG;
const { REGISTER_ERROR } = REGISTER_CONFIG;
const { not_unique, invalid_length, already_exits } = REGISTER_ERROR;

class InvalidCredentialsError extends Error {
  constructor() {
    super(LOGIN_ERROR.invalid);
    this.statusCode = 401;
  }
}

async function register(email, password) {
  email = normalizeEmail(email);

  if (!validateEmail(email)) throw new Error(not_unique);
  if (password.length < 8) throw new Error(invalid_length);

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await neo4jDriver.executeQuery(
       `CREATE ( u:User { id: randomUUID(), email: $email, passwordHash: $passwordHash, createdAt: datetime(), updatedAt: datetime(), role : "user"})
      RETURN u {.id, .email, .createdAt, .role } AS user
      `,
      { email, passwordHash },
      { database },
    );
    return result.records[0].get("user");
  } catch (e) {
    throw new Error(
      e.code?.includes("ConstraintValidationFailed")
        ? already_exits
        : e.message,
    );
  }
}

async function login(email, password) {
  email = normalizeEmail(email);
  const result = await neo4jDriver.executeQuery(
     `MATCH (u:User {email: $email})
      RETURN u {.id, .email, .passwordHash, .role } AS user
      LIMIT 1`,
    { email },
    { database },
  );
  if (result.records.length === 0) throw new InvalidCredentialsError();
  const { passwordHash, id, ...user } = result.records[0].get("user");
  const validPassword = await bcrypt.compare(password, passwordHash);
  if (!validPassword) throw new InvalidCredentialsError();
  return { id, email: user.email, role: user.role };
}

module.exports = { InvalidCredentialsError, login, register, issueAccessToken };
