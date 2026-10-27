const { createMockReq, createMockRes } = require("../../helpers/mockReqRes");

function loadRateLimiter(windowMs, limit) {
  jest.resetModules();
  jest.doMock("../../../provider/config.map", () => ({
    windowMs,
    limit,
  }));
  return require("../../../layers/rate.limiting.layer");
}

describe("layers/rate.limiting.layer.js", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  it("is a function, not Express middleware", () => {
    const rateLimiter = loadRateLimiter(1000, 10);
    expect(typeof rateLimiter).toBe("function");
    expect(rateLimiter.length).toBe(2);
  });

  it("allows requests until limit then returns 429", () => {
    const rateLimiter = loadRateLimiter(60_000, 2);
    const ip = "10.0.0.1";

    expect(rateLimiter(createMockReq({ socket: { remoteAddress: ip } }), createMockRes())).toBe(
      true,
    );
    expect(rateLimiter(createMockReq({ socket: { remoteAddress: ip } }), createMockRes())).toBe(
      true,
    );

    const res = createMockRes();
    const allowed = rateLimiter(createMockReq({ socket: { remoteAddress: ip } }), res);

    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.getHeader("RateLimit-Limit")).toBe(2);
    expect(res.getHeader("RateLimit-Remaining")).toBe(0);
    expect(res.getHeader("Retry-After")).toBeDefined();
    expect(JSON.parse(res.body)).toEqual({
      status: false,
      statusCode: 429,
      message: "Too Many Requests",
    });
  });

  it("tracks IPs independently", () => {
    const rateLimiter = loadRateLimiter(60_000, 1);

    expect(
      rateLimiter(createMockReq({ socket: { remoteAddress: "1.1.1.1" } }), createMockRes()),
    ).toBe(true);
    expect(
      rateLimiter(createMockReq({ socket: { remoteAddress: "2.2.2.2" } }), createMockRes()),
    ).toBe(true);
  });

  it("resets counter after windowMs", () => {
    const rateLimiter = loadRateLimiter(1000, 1);
    const ip = "9.9.9.9";

    expect(rateLimiter(createMockReq({ socket: { remoteAddress: ip } }), createMockRes())).toBe(
      true,
    );
    const overRes = createMockRes();
    expect(rateLimiter(createMockReq({ socket: { remoteAddress: ip } }), overRes)).toBe(
      false,
    );
    expect(overRes.statusCode).toBe(429);

    jest.advanceTimersByTime(1001);

    expect(rateLimiter(createMockReq({ socket: { remoteAddress: ip } }), createMockRes())).toBe(
      true,
    );
  });
});
