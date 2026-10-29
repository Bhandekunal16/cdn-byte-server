const { WRITE_L0G, LOG_REQUESTS, exclude } = require("../provider/config.map");

const append = require("../core/file.functions");

const hasExclusions = Array.isArray(exclude) && exclude.length > 0;

module.exports = function logger(req, _res, next) {
  if (!LOG_REQUESTS && !WRITE_L0G) {
    next();
    return;
  }

  const request = {
    method: req.method,
    url: req.path || req.originalUrl?.split("?")[0],
    requestId: req.requestId || req.headers["x-request-id"] || "N/A",
    ip: req.ip,
  };

  if (req.params && Object.keys(req.params).length > 0)
    request.params = req.params;

  if (hasExclusions) {
    for (const property of exclude) {
      delete request[property];
    }
  }

  const output = JSON.stringify(request);

  if (WRITE_L0G) append(output);
  if (LOG_REQUESTS) console.log(`request: ${output}`);

  next();
};
