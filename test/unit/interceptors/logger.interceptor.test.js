jest.mock("../../../core/file.functions", () => jest.fn());

const append = require("../../../core/file.functions");

function loadLogger({ exclude = [], WRITE_L0G = false } = {}) {
  jest.resetModules();
  jest.doMock("../../../provider/config.map", () => ({ exclude, WRITE_L0G }));
  jest.mock("../../../core/file.functions", () => jest.fn());
  return require("../../../interceptors/logger.interceptor");
}

describe("interceptors/logger.interceptor.js", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    jest.resetModules();
  });

  it("logs request fields and honors exclude list", () => {
    const logger = loadLogger({ exclude: ["body", "headers"], WRITE_L0G: false });
    const req = {
      method: "POST",
      originalUrl: "/x?y=1",
      url: "/x?y=1",
      baseUrl: "",
      path: "/x",
      protocol: "http",
      hostname: "localhost",
      host: "localhost",
      ip: "127.0.0.1",
      ips: [],
      params: { id: "1" },
      query: { y: "1" },
      body: { secret: true },
      headers: { authorization: "x" },
      requestId: "rid-1",
    };
    const next = jest.fn();

    logger(req, {}, next);

    const logged = JSON.parse(console.log.mock.calls[0][0].replace(/^request: /, ""));
    expect(logged.method).toBe("POST");
    expect(logged.requestId).toBe("rid-1");
    expect(logged.body).toBeUndefined();
    expect(logged.headers).toBeUndefined();
    expect(logged.query).toEqual({ y: "1" });
    expect(next).toHaveBeenCalled();
  });

  it("appends to file when WRITE_L0G is enabled", () => {
    jest.resetModules();
    jest.doMock("../../../provider/config.map", () => ({
      exclude: [],
      WRITE_L0G: true,
    }));
    jest.doMock("../../../core/file.functions", () => jest.fn());
    const logger = require("../../../interceptors/logger.interceptor");
    const appendMock = require("../../../core/file.functions");

    logger(
      {
        method: "GET",
        originalUrl: "/",
        url: "/",
        baseUrl: "",
        path: "/",
        protocol: "http",
        hostname: "h",
        host: "h",
        ip: "1",
        ips: [],
        params: {},
        query: {},
        body: {},
        headers: { "x-request-id": "hdr-id" },
      },
      {},
      jest.fn(),
    );

    expect(appendMock).toHaveBeenCalled();
  });
});
