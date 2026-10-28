const { login, register, httpResponse } = require("../provider/service.map");

module.exports = function userRoutes(app) {
  app.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password)
        return httpResponse(res, 400, {
          msg: "Required fields are missing",
          status: false,
          data: { error: "email and password are required" },
        });

      const user = await login(email, password);

      return httpResponse(res, 200, {
        msg: "Login successful",
        status: true,
        data: { user },
      });
    } catch (error) {
      return httpResponse(res, 500, {
        msg: "Login failed",
        status: false,
        data: error.message,
      });
    }
  });

  app.post("/register", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password)
        return httpResponse(res, 400, {
          msg: "Required fields are missing",
          status: false,
          data: { error: "email and password are required" },
        });

      const user = await register(email, password);

      return httpResponse(res, 201, {
        msg: "Registration successful",
        status: false,
        data: { user },
      });
    } catch (error) {
      return httpResponse(res, 500, {
        msg: "Registration failed",
        status: false,
        data: { error: error.message },
      });
    }
  });
};
