function createMockReq(overrides = {}) {
  return {
    method: "GET",
    originalUrl: "/",
    url: "/",
    baseUrl: "",
    path: "/",
    protocol: "http",
    hostname: "localhost",
    host: "localhost:3000",
    ip: "127.0.0.1",
    ips: [],
    params: {},
    query: {},
    body: {},
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name) {
      return res.headers[name.toLowerCase()];
    },
    writeHead(code, headers) {
      res.statusCode = code;
      res.headersSent = true;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v);
        }
      }
      return res;
    },
    end(body) {
      res.body = body;
      res.writableEnded = true;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      res.headersSent = true;
      return res;
    },
    on() {},
    once(event, fn) {
      if (event === "finish") res._finish = fn;
      return res;
    },
    emitFinish() {
      if (res._finish) res._finish();
    },
  };
  return res;
}

module.exports = { createMockReq, createMockRes };
