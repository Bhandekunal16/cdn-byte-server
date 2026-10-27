const createProxyRequestTracker = require("../../../proxy/proxy.request.tracker");

describe("proxy/proxy.request.tracker.js", () => {
  it("tracks proxyReq until close", () => {
    const { track, activeRequests } = createProxyRequestTracker();
    const proxyReq = { once: jest.fn((event, fn) => (proxyReq._close = fn)) };

    track(proxyReq);
    expect(activeRequests.size).toBe(1);

    proxyReq._close();
    expect(activeRequests.size).toBe(0);
  });
});
