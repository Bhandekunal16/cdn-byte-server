const { encryptJson } = require("../../fixtures/encryption/encryptPayload");
const { createMockReq, createMockRes } = require("../../helpers/mockReqRes");

describe("interceptors/encryption.interceptor.js", () => {
  const encryptionInterceptor = require("../../../interceptors/encryption.interceptor");

  it("passes through when body has no data field", () => {
    const req = createMockReq({ body: { hello: "world" } });
    const res = createMockRes();
    const next = jest.fn();

    encryptionInterceptor(req, res, next);

    expect(req.body).toEqual({ hello: "world" });
    expect(next).toHaveBeenCalled();
    expect(typeof res.json).toBe("function");
  });

  it("decrypts valid encrypted payload into req.body", () => {
    const payload = { secret: "value" };
    const req = createMockReq({ body: { data: encryptJson(payload) } });
    const res = createMockRes();
    const next = jest.fn();

    encryptionInterceptor(req, res, next);

    expect(req.body).toEqual(payload);
    expect(next).toHaveBeenCalled();
  });

  it("returns 400 for malformed encrypted data", () => {
    const req = createMockReq({ body: { data: "not-valid" } });
    const res = createMockRes();
    const next = jest.fn();

    encryptionInterceptor(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Invalid encrypted data" });
    expect(next).not.toHaveBeenCalled();
  });

  it("encrypts outgoing json responses", () => {
    const req = createMockReq({ body: {} });
    const res = createMockRes();
    const next = jest.fn();

    encryptionInterceptor(req, res, next);
    res.json({ ok: true });

    expect(res.body).toHaveProperty("data");
    expect(typeof res.body.data).toBe("string");
  });
});
