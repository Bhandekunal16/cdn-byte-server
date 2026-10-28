const { bcrypt } = require("../provider/dependency.map");
const { neo4jDriver } = require("../database/neo4j.service");
const { normalizeEmail, validateEmail } = require("../enums/regex.enums");
const {
  neo4j,
  LOGIN_CONFIG,
  REGISTER_CONFIG,
} = require("../provider/config.map");

const { NEO4J_DATABASE: database } = neo4j;
const { LOGIN_ERROR } = LOGIN_CONFIG;
const { REGISTER_ERROR } = REGISTER_CONFIG;
const { not_unique, invalid_length, already_exits } = REGISTER_ERROR;

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
    if (e.code?.includes("ConstraintValidationFailed"))
      throw new Error(already_exits);

    throw e;
  }
}

async function login(email, password) {
  try {
    email = normalizeEmail(email);

    const result = await neo4jDriver.executeQuery(
      ` MATCH (u:User {email: $email})
      RETURN u {.id, .email, .passwordHash, .role } AS user
      LIMIT 1`,
      { email },
      { database },
    );

    if (result.records.length === 0) throw new Error(LOGIN_ERROR.invalid);
    const { passwordHash, id, ...user } = result.records[0].get("user");
    const validPassword = await bcrypt.compare(password, passwordHash);

    if (!validPassword) throw new Error(LOGIN_ERROR.invalid);
    return { id, email: user.email, role: user.role };
  } catch (error) {
    throw new Error(error.message);
  }
}

module.exports = { login, register };
