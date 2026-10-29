const { httpResponse } = require("../core/unified-response");
const {
  TokenConfigurationError,
  verifyAccessToken,
} = require("../service/access-token.service");

module.exports = function requireAuthentication(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) {
    res.set("WWW-Authenticate", "Bearer");
    return httpResponse(res, 401, {
      msg: "Authentication required",
      status: false,
      data: { error: "A valid bearer token is required" },
    });
  }

  try {
    req.auth = verifyAccessToken(match[1]);
    return next();
  } catch (error) {
    if (error instanceof TokenConfigurationError) {
      return httpResponse(res, 503, {
        msg: "Authentication is temporarily unavailable",
        status: false,
        data: { error: "Authentication is not configured" },
      });
    }

    res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
    return httpResponse(res, 401, {
      msg: "Invalid or expired access token",
      status: false,
      data: { error: "Authentication required" },
    });
  }
};
