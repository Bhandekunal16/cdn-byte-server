jest.mock("../../../database/neo4j.service", () => ({
  neo4jDriver: { executeQuery: jest.fn() },
}));

jest.mock("../../../provider/dependency.map", () => ({
  ...jest.requireActual("../../../provider/dependency.map"),
  bcrypt: {
    hash: jest.fn().mockResolvedValue("hashed-password"),
    compare: jest.fn().mockResolvedValue(true),
  },
}));

const express = require("express");
const request = require("supertest");
const { neo4jDriver } = require("../../../database/neo4j.service");
const { bcrypt } = require("../../../provider/dependency.map");
const { AUTH_TOKEN_TTL_SECONDS } = require("../../../provider/config.map");
const { verifyAccessToken } = require("../../../service/access-token.service");
const userRoutes = require("../../../routes/user.routes");

describe("user authentication routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    userRoutes(app);
    return app;
  }

  it("returns an expiring access token after valid login", async () => {
    neo4jDriver.executeQuery.mockResolvedValue({
      records: [
        {
          get: () => ({
            id: "user-1",
            email: "person@gmail.com",
            role: "user",
            passwordHash: "hashed-password",
          }),
        },
      ],
    });

    const response = await request(createApp())
      .post("/login")
      .send({ email: "Person@gmail.com", password: "correct-password" })
      .expect(200);

    expect(response.body.data.user).toEqual({
      id: "user-1",
      email: "person@gmail.com",
      role: "user",
    });
    expect(typeof response.body.data.accessToken).toBe("string");
    expect(response.body.data.expiresAt).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
    const remainingLifetime =
      response.body.data.expiresAt - Math.floor(Date.now() / 1000);
    expect(remainingLifetime).toBeLessThanOrEqual(AUTH_TOKEN_TTL_SECONDS);
    expect(remainingLifetime).toBeGreaterThanOrEqual(AUTH_TOKEN_TTL_SECONDS - 1);
    expect(verifyAccessToken(response.body.data.accessToken)).toMatchObject({
      userId: "user-1",
      email: "person@gmail.com",
    });
  });

  it("returns 401 for invalid credentials without exposing backend errors", async () => {
    neo4jDriver.executeQuery.mockResolvedValue({ records: [] });
    bcrypt.compare.mockResolvedValue(false);

    const response = await request(createApp())
      .post("/login")
      .send({ email: "person@gmail.com", password: "wrong-password" })
      .expect(401);

    expect(response.body.message).toBe("Login failed");
    expect(response.body.data.error).toBe("Invalid email or password");
    expect(response.body.data.error).not.toContain("wrong-password");
  });
});
