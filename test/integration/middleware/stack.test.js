const request = require("supertest");
const requestId = require("../../../layers/request.id.layer");
const logger = require("../../../interceptors/logger.interceptor");

describe("middleware stack behavior", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  it("logger resolves request ID after request ID middleware", async () => {
    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use(requestId);
    app.use(logger);
    app.get("/id", (req, res) => res.json({ id: req.requestId }));

    const res = await request(app).get("/id").set("X-Request-ID", "stack-id");

    expect(res.body.id).toBe("stack-id");
    const logged = JSON.parse(console.log.mock.calls[0][0].replace(/^request: /, ""));
    expect(logged.requestId).toBe("stack-id");
  });
});
