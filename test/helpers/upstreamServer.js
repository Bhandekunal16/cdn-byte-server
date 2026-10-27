const http = require("http");

function createUpstreamServer(handler) {
  const defaultHandler = (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "X-Upstream": "1",
      });
      res.end(`${req.method} ${req.url} ${body}`);
    });
  };

  const server = http.createServer(handler || defaultHandler);

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        host: "127.0.0.1",
        port,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
    server.on("error", reject);
  });
}

module.exports = { createUpstreamServer };
