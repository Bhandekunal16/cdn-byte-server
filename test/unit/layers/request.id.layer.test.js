const crypto = require("crypto");
const requestId = require("../../../layers/request.id.layer");
const { createMockReq, createMockRes } = require("../../helpers/mockReqRes");

describe("layers/request.id.layer.js", () => {
  it("reuses incoming x-request-id", () => {
    const req = createMockReq({ headers: { "x-request-id": "abc-123" } });
    const res = createMockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.requestId).toBe("abc-123");
    expect(res.getHeader("X-Request-ID")).toBe("abc-123");
    expect(next).toHaveBeenCalled();
  });

  it("generates UUID when header is missing", () => {
    jest.spyOn(crypto, "randomUUID").mockReturnValue("generated-uuid");

    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.requestId).toBe("generated-uuid");
    expect(res.getHeader("X-Request-ID")).toBe("generated-uuid");

    crypto.randomUUID.mockRestore();
  });
});
