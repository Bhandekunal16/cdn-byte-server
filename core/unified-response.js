class UnifiedResponse {
  constructor(message, statusCode, status, data) {
    this.message = message;
    this.statusCode = statusCode;
    this.status = status;
    this.data = data;
  }
}

module.exports = { UnifiedResponse };
