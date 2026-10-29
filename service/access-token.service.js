const jwt = require("jsonwebtoken");
const { AUTH_TOKEN_TTL_SECONDS, AUTH_TOKEN_SECRET } = require("../provider/config.map");

const ISSUER = "cdn-byte-server";
const AUDIENCE = "pixelvault-android";
const DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MAX_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

class TokenConfigurationError extends Error {}

function getTokenConfiguration() {
  const secret = AUTH_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32)
    throw new TokenConfigurationError(
      "AUTH_TOKEN_SECRET must contain at least 32 bytes",
    );

  const ttlSeconds = AUTH_TOKEN_TTL_SECONDS ?? DEFAULT_TOKEN_TTL_SECONDS;
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 300 ||
    ttlSeconds > MAX_TOKEN_TTL_SECONDS
  )
    throw new TokenConfigurationError(
      "AUTH_TOKEN_TTL_SECONDS in json/app.json must be an integer between 300 and 604800",
    );

  return { secret, ttlSeconds };
}

function issueAccessToken(user) {
  const { secret, ttlSeconds } = getTokenConfiguration();
  if (!user?.id || !user.email)
    throw new Error("Cannot issue an access token without a user identity");

  const issuedAt = Math.floor(Date.now() / 1000);
  const accessToken = jwt.sign(
    { email: user.email, role: user.role || "user", iat: issuedAt },
    secret,
    {
      algorithm: "HS256",
      audience: AUDIENCE,
      expiresIn: ttlSeconds,
      issuer: ISSUER,
      subject: String(user.id),
      noTimestamp: false,
    },
  );
  return { accessToken, expiresAt: issuedAt + ttlSeconds };
}

function verifyAccessToken(token) {
  const { secret } = getTokenConfiguration();
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    audience: AUDIENCE,
    issuer: ISSUER,
  });
  if (
    typeof payload !== "object" ||
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    typeof payload.email !== "string" ||
    payload.email.length === 0 ||
    typeof payload.exp !== "number"
  )
    throw new jwt.JsonWebTokenError("Invalid access token claims");

  return {
    userId: payload.sub,
    email: payload.email,
    role: typeof payload.role === "string" ? payload.role : "user",
    expiresAt: payload.exp,
  };
}

module.exports = {
  TokenConfigurationError,
  getTokenConfiguration,
  issueAccessToken,
  verifyAccessToken,
};
