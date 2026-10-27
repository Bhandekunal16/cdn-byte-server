module.exports = function error(err, _req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err?.status >= 400 && err.status < 600 ? err.status : 500;

  return res.status(statusCode).json({
    message: err?.message || "Internal Server Error",
    status: false,
    statusCode,
  });
};
