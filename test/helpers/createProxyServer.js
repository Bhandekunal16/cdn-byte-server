const rateLimiter = require("../../layers/rate.limiting.layer");
const { isShuttingDown } = require("../../layers/graceful.shutdown.layer");
const proxyRequestAbortHandler = require("../../proxy/proxy.request.abort.handler");
const {
  updateResponseTimeout,
  updateRequestTimeout,
} = require("../../proxy/proxy.timeout.handler");
const sendBadGateway = require("../../proxy/proxy.error.handler");
const createProxyRequestTracker = require("../../proxy/proxy.request.tracker");
const { http } = require("../../provider/dependency.map");

function upstreamHostname(host) {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

/** Test factory — mirrors proxy.js request handler (not used by proxy.js). */
function createProxyServer(config) {
  const {
    host: TARGET_HOST,
    port: TARGET_PORT,
    rateLimiting,
    PROXY_TIMEOUT,
    ENABLE_UPSTREAM_REQUEST_TIMEOUT,
    ENABLE_UPSTREAM_RESPONSE_TIMEOUT,
  } = config;

  const { track, activeRequests } = createProxyRequestTracker();

  const server = http.createServer((req, res) => {
    if (isShuttingDown()) {
      if (!res.headersSent) {
        res.writeHead(503, { "Content-Type": "text/plain" });
      }
      if (!res.writableEnded) {
        res.end("Service Unavailable");
      }
      return;
    }

    if (rateLimiting && !rateLimiter(req, res)) return;

    const { url: path, method, headers } = req;

    const proxyReq = http.request(
      {
        hostname: upstreamHostname(TARGET_HOST),
        port: TARGET_PORT,
        path,
        method,
        headers,
      },
      (proxyRes) => {
        const { statusCode, headers: upstreamHeaders } = proxyRes;

        if (ENABLE_UPSTREAM_RESPONSE_TIMEOUT) {
          updateResponseTimeout(proxyRes, res, PROXY_TIMEOUT);
        }

        res.writeHead(statusCode, upstreamHeaders);
        proxyRes.pipe(res);
      },
    );

    track(proxyReq);

    if (ENABLE_UPSTREAM_REQUEST_TIMEOUT) {
      updateRequestTimeout(proxyReq, res, PROXY_TIMEOUT);
    }

    sendBadGateway(proxyReq, res);
    proxyRequestAbortHandler(req, proxyReq);

    req.pipe(proxyReq);
  });

  return { server, activeRequests };
}

module.exports = { createProxyServer };
