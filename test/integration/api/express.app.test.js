const request = require("supertest");
const { loadCreateExpressApp } = require("../../helpers/createTestApp");

describe("API integration", () => {
  it("GET / returns hello world JSON", async () => {
    const { bootstrap, registerErrorMiddleware } = loadCreateExpressApp();
    const { app } = bootstrap();
    registerErrorMiddleware(app);

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "hello world" });
  });

  it("unknown route returns 404 contract", async () => {
    const { bootstrap, registerErrorMiddleware } = loadCreateExpressApp();
    const { app } = bootstrap();
    registerErrorMiddleware(app);

    const res = await request(app).get("/missing");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      status: false,
      statusCode: 404,
      message: "Not Found",
    });
  });
});
