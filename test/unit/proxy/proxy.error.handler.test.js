const sendBadGateway = require("../../../proxy/proxy.error.handler");

describe("proxy/proxy.error.handler.js", () => {
  it("responds with 502 when upstream request errors", () => {
    const handlers = {};
    const proxyReq = {
      on: (event, fn) => {
        handlers[event] = fn;
      },
    };
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead: jest.fn(),
      end: jest.fn(),
    };

    sendBadGateway(proxyReq, res);
    handlers.error();

    expect(res.writeHead).toHaveBeenCalledWith(502);
    expect(res.end).toHaveBeenCalledWith("Bad Gateway");
  });
});
