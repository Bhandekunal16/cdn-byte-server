const { UnifiedResponse, httpResponse } = require("../core/unified-response");
const services = {
  authService: require("../service/auth.service"),
  base64Service: require("../service/base64.service"),
  imageService: require("../service/image.service"),
  storageService: require("../service/storage.service"),
  UnifiedResponse,
  httpResponse,
  ok: { status: true },
  failed: { status: false },
};

module.exports = services;
const { login, register } = services.authService;

module.exports = {
  imageServiceInstance: new services.imageService(),
  storageServiceInstance: new services.storageService(),
  login,
  register,
};
