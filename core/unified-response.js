class UnifiedResponse {
  constructor(message, statusCode, status, data) {
    this.message = message;
    this.statusCode = statusCode;
    this.status = status;
    this.data = data;
  }
}

function httpResponse(response, code, body) {
  response
    .status(code)
    .json(new UnifiedResponse(body.msg, code, body.status, body.data));
}

module.exports = { UnifiedResponse, httpResponse };
