const http = require("http");
const { createProxyServer } = require("../../../createProxyServer");
const { createUpstreamServer } = require("../../helpers/upstreamServer");

function proxyRequest(port, path = "/", options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method || "GET",
        headers: options.headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe("createProxyServer integration", () => {
  let upstream;

  afterEach(async () => {
    if (upstream) await upstream.close();
  });

  it("forwards method, path, query, headers, and body", async () => {
    upstream = await createUpstreamServer();
    const { server } = createProxyServer({
      host: upstream.host,
      port: upstream.port,
      rateLimiting: false,
      PROXY_TIMEOUT: 5000,
      ENABLE_UPSTREAM_REQUEST_TIMEOUT: false,
      ENABLE_UPSTREAM_RESPONSE_TIMEOUT: false,
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const proxyPort = server.address().port;

    const res = await proxyRequest(proxyPort, "/hello?q=1", {
      method: "POST",
      headers: { "X-Test": "1" },
      body: "payload",
    });

    expect(res.status).toBe(200);
    expect(res.body).toContain("POST /hello?q=1 payload");
    expect(res.headers["x-upstream"]).toBe("1");

    await new Promise((r) => server.close(r));
  });

  it("returns 502 when upstream is unreachable", async () => {
    const { server } = createProxyServer({
      host: "127.0.0.1",
      port: 1,
      rateLimiting: false,
      PROXY_TIMEOUT: 500,
      ENABLE_UPSTREAM_REQUEST_TIMEOUT: false,
      ENABLE_UPSTREAM_RESPONSE_TIMEOUT: false,
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const res = await proxyRequest(server.address().port);
    expect(res.status).toBe(502);
    await new Promise((r) => server.close(r));
  });

  it("returns 503 when shutting down", async () => {
    jest.resetModules();
    jest.doMock("../../../layers/graceful.shutdown.layer", () => ({
      ...jest.requireActual("../../../layers/graceful.shutdown.layer"),
      isShuttingDown: () => true,
    }));
    const { createProxyServer: createProxy } = require("../../../createProxyServer");

    upstream = await createUpstreamServer();
    const { server } = createProxy({
      host: upstream.host,
      port: upstream.port,
      rateLimiting: false,
      PROXY_TIMEOUT: 5000,
      ENABLE_UPSTREAM_REQUEST_TIMEOUT: false,
      ENABLE_UPSTREAM_RESPONSE_TIMEOUT: false,
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const res = await proxyRequest(server.address().port);
    expect(res.status).toBe(503);
    await new Promise((r) => server.close(r));
    jest.resetModules();
  });
});
