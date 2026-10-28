const { bcrypt } = require("../provider/dependency.map");
const { neo4jDriver } = require("../database/neo4j.service");
const {
  normalizeEmail,
  validateEmail,
  loginQuery,
  registerQuery,
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

async function register(email, password) {
  email = normalizeEmail(email);

  if (!validateEmail(email)) throw new Error(not_unique);
  if (password.length < 8) throw new Error(invalid_length);

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await neo4jDriver.executeQuery(
      registerQuery,
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
  try {
    email = normalizeEmail(email);

    const result = await neo4jDriver.executeQuery(
      loginQuery,
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
