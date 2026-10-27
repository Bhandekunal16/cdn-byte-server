jest.mock("../../../core/file.functions", () => jest.fn());

function loadResponseLogger(WRITE_L0G = false) {
  jest.resetModules();
  jest.doMock("../../../provider/config.map", () => ({ WRITE_L0G }));
  jest.doMock("../../../core/file.functions", () => jest.fn());
  return {
    logger: require("../../../interceptors/response.interceptor"),
    append: require("../../../core/file.functions"),
  };
}

describe("interceptors/response.interceptor.js", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    jest.resetModules();
  });

  it("logs response summary on finish", () => {
    const { logger } = loadResponseLogger(false);
    const req = {
      method: "GET",
      originalUrl: "/health",
      requestId: "r1",
      headers: {},
    };
    const res = {
      statusCode: 200,
      getHeader: () => "12",
      on: (event, fn) => {
        if (event === "finish") fn();
      },
    };

    logger(req, res, jest.fn());

    expect(console.log.mock.calls[0][0]).toMatch(/^response: /);
    const payload = JSON.parse(console.log.mock.calls[0][0].replace(/^response: /, ""));
    expect(payload).toMatchObject({
      requestId: "r1",
      method: "GET",
      originalUrl: "/health",
      statusCode: 200,
      contentLength: "12",
    });
    expect(typeof payload.durationMs).toBe("number");
  });

  it("writes file when WRITE_L0G enabled", () => {
    const { logger, append } = loadResponseLogger(true);
    const res = {
      statusCode: 201,
      getHeader: () => 0,
      on: (event, fn) => {
        if (event === "finish") fn();
      },
    };

    logger({ method: "POST", originalUrl: "/", headers: {} }, res, jest.fn());
    expect(append).toHaveBeenCalled();
  });
});
