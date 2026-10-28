const { login, register } = require("../service/auth.service");
const UnifiedResponse = require("../core/unified-response");

module.exports = function userRoutes(app) {
  app.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        res.status(400).json(
          new UnifiedResponse("Required fields are missing", 400, false, {
            error: "email and password are required",
          }),
        );
      }

      const user = await login(email, password);

      res
        .status(200)
        .json(new UnifiedResponse("Login successful", 200, true, { user }));
    } catch (error) {
      return res.status(500).json(
        new UnifiedResponse("Login failed", 500, false, {
          error: error.message,
        }),
      );
    }
  });

  app.post("/register", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        res.status(400).json(
          new UnifiedResponse("Required fields are missing", 400, false, {
            error: "email and password are required",
          }),
        );
      }

      const user = await register(email, password);

      res
        .status(201)
        .json(
          new UnifiedResponse("Registration successful", 201, true, { user }),
        );
    } catch (error) {
      return res.status(500).json(
        new UnifiedResponse("Registration failed", 500, false, {
          error: error.message,
        }),
      );
    }
  });
};
