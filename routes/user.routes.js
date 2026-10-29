const { login, register } = require("../provider/service.map");
const {
  InvalidCredentialsError,
  issueAccessToken,
} = require("../service/auth.service");
const { TokenConfigurationError } = require("../service/access-token.service");
const { httpResponse } = require("../core/unified-response.js");

module.exports = function userRoutes(app) {
  app.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password)
        return httpResponse(res, 400, {
          msg: "Required fields are missing",
          ...failed,
          data: { error: "email and password are required" },
        });

      const user = await login(email, password);
      const session = issueAccessToken(user);

      return httpResponse(res, 200, {
        msg: "Login successful",
        status: true,
        data: { user, ...session },
      });
    } catch (e) {
      const statusCode =
        e instanceof InvalidCredentialsError
          ? 401
          : e instanceof TokenConfigurationError
            ? 503
            : 500;
      return httpResponse(res, statusCode, {
        msg: "Login failed",
        status: false,
        data: {
          error:
            statusCode === 401
              ? "Invalid email or password"
              : statusCode === 503
                ? "Authentication is not configured"
                : "Authentication failed",
        },
      });
    }
  });

  app.post("/register", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password)
        return httpResponse(res, 400, {
          msg: "Required fields are missing",
          ...failed,
          data: { error: "email and password are required" },
        });

      const user = await register(email, password);

      return httpResponse(res, 201, {
        msg: "Registration successful",
        status: true,
        data: { user },
      });
    } catch (e) {
      return httpResponse(res, 500, {
        msg: "Registration failed",
        status: false,
        data: { error: e.message },
      });
    }
  });
};
