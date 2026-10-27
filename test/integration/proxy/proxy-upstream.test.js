const http = require("http");
const { createProxyServer } = require("../../../createProxyServer");

describe("proxy upstream timeouts and rate limiting", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("returns 504 on upstream request timeout", async () => {
    const slowServer = http.createServer(() => {});
    await new Promise((r) => slowServer.listen(0, "127.0.0.1", r));
    const upstreamAddr = slowServer.address();

    const { server } = createProxyServer({
      host: upstreamAddr.address,
      port: upstreamAddr.port,
      rateLimiting: false,
      PROXY_TIMEOUT: 50,
      ENABLE_UPSTREAM_REQUEST_TIMEOUT: true,
      ENABLE_UPSTREAM_RESPONSE_TIMEOUT: false,
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));

    const res = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${server.address().port}/slow`, (response) => {
        const chunks = [];
        response.on("data", (c) => chunks.push(c));
        response.on("end", () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }),
        );
      });
      req.on("error", reject);
    });

    expect(res.status).toBe(504);

    await new Promise((r) => server.close(r));
    await new Promise((r) => slowServer.close(r));
  });

  it("rate limits before contacting upstream", async () => {
    jest.resetModules();
    const rateLimiter = jest
      .fn()
      .mockImplementationOnce(() => true)
      .mockImplementationOnce((_req, res) => {
        res.writeHead(429);
        res.end("limited");
        return false;
      });
    jest.doMock("../../../layers/rate.limiting.layer", () => rateLimiter);
    const { createProxyServer: createProxy } = require("../../../createProxyServer");

    let upstreamHits = 0;
    const upstream = http.createServer((_, res) => {
      upstreamHits += 1;
      res.end("ok");
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const upstreamAddr = upstream.address();

    const { server } = createProxy({
      host: upstreamAddr.address,
      port: upstreamAddr.port,
      rateLimiting: true,
      PROXY_TIMEOUT: 1000,
      ENABLE_UPSTREAM_REQUEST_TIMEOUT: false,
      ENABLE_UPSTREAM_RESPONSE_TIMEOUT: false,
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const proxyPort = server.address().port;

    await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxyPort}/`, (res) => {
        res.resume();
        res.on("end", resolve);
      }).on("error", reject);
    });

    const blocked = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxyPort}/`, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on("error", reject);
    });

    expect(blocked.status).toBe(429);
    expect(upstreamHits).toBe(1);

    await new Promise((r) => server.close(r));
    await new Promise((r) => upstream.close(r));
  });
});
