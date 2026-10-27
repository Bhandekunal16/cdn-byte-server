const http = require("http");
const request = require("supertest");
const { loadCreateExpressApp } = require("../../helpers/createTestApp");
const { createProxyServer } = require("../../../createProxyServer");

describe("proxy to API e2e", () => {
  let apiServer;
  let proxyServer;
  let apiPort;
  let proxyPort;

  beforeEach(async () => {
    const { bootstrap, registerErrorMiddleware } = loadCreateExpressApp();
    const { app } = bootstrap();
    registerErrorMiddleware(app);

    apiServer = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    apiPort = apiServer.address().port;

    const built = createProxyServer({
      host: "127.0.0.1",
      port: apiPort,
      rateLimiting: false,
      PROXY_TIMEOUT: 5000,
      ENABLE_UPSTREAM_REQUEST_TIMEOUT: false,
      ENABLE_UPSTREAM_RESPONSE_TIMEOUT: false,
    });
    proxyServer = built.server;
    await new Promise((r) => proxyServer.listen(0, "127.0.0.1", r));
    proxyPort = proxyServer.address().port;
  });

  afterEach(async () => {
    await new Promise((r) => proxyServer.close(r));
    await new Promise((r) => apiServer.close(r));
  });

  it("proxies GET / to Express API", async () => {
    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${proxyPort}/`, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        })
        .on("error", reject);
    });

    expect(body).toEqual({ message: "hello world" });
  });

  it("direct API remains reachable when proxy is up", async () => {
    const { bootstrap, registerErrorMiddleware } = loadCreateExpressApp();
    const { app } = bootstrap();
    registerErrorMiddleware(app);
    const res = await request(app).get("/");
    expect(res.body.message).toBe("hello world");
  });
});
