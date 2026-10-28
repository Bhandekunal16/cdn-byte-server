const services = {
  authService: require("../service/auth.service"),
  base64Service: require("../service/base64.service"),
  imageService: require("../service/image.service"),
  storageService: require("../service/storage.service"),
};

module.exports = services;

module.exports = {
  imageServiceInstance: new services.imageService(),
  storageServiceInstance: new services.storageService(),
};
