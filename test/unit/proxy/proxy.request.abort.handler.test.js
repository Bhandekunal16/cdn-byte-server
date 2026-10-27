const fallbackProxy = require("../../../proxy/proxy.request.abort.handler");

describe("proxy/proxy.request.abort.handler.js", () => {
  it("destroys upstream request on client aborted", () => {
    const handlers = {};
    const req = {
      complete: false,
      once: (event, fn) => {
        handlers[event] = fn;
      },
    };
    const proxyReq = { destroyed: false, destroy: jest.fn() };

    fallbackProxy(req, proxyReq);
    handlers.aborted();

    expect(proxyReq.destroy).toHaveBeenCalled();
  });

  it("destroys upstream on close when request is incomplete", () => {
    const handlers = {};
    const req = {
      complete: false,
      once: (event, fn) => {
        handlers[event] = fn;
      },
    };
    const proxyReq = { destroyed: false, destroy: jest.fn() };

    fallbackProxy(req, proxyReq);
    handlers.close();

    expect(proxyReq.destroy).toHaveBeenCalled();
  });
});
