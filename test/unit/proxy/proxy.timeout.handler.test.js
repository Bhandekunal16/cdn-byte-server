const {
  updateRequestTimeout,
  updateResponseTimeout,
} = require("../../../proxy/proxy.timeout.handler");

describe("proxy/proxy.timeout.handler.js", () => {
  it("updateRequestTimeout responds with 504 on timeout", () => {
    const proxyReq = {
      destroyed: false,
      destroy: jest.fn(),
      setTimeout: jest.fn((_, cb) => cb()),
    };
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead: jest.fn(),
      end: jest.fn(),
    };

    updateRequestTimeout(proxyReq, res, 50);

    expect(proxyReq.destroy).toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(504);
    expect(res.end).toHaveBeenCalledWith("Gateway Timeout");
  });

  it("updateResponseTimeout responds with 504 on timeout", () => {
    const proxyRes = {
      destroy: jest.fn(),
      setTimeout: jest.fn((_, cb) => cb()),
    };
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead: jest.fn(),
      end: jest.fn(),
    };

    updateResponseTimeout(proxyRes, res, 50);

    expect(proxyRes.destroy).toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(504);
  });
});
