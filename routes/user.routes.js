const { login, register, ok, failed } = require("../provider/service.map");
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

      return httpResponse(res, 200, {
        msg: "Login successful",
        ...ok,
        data: { user },
      });
    } catch (err) {
      return httpResponse(res, 500, {
        msg: "Login failed",
        ...failed,
        data: err.message,
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
        ...ok,
        data: { user },
      });
    } catch (err) {
      return httpResponse(res, 500, {
        msg: "Registration failed",
        ...failed,
        data: { error: err.message },
      });
    }
  });
};
