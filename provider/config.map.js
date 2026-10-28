const environment = {
  config: require("../json/config.json"),
  app: require("../json/app.json"),
  rateLimiting: require("../json/rate-limiting.config.json"),
  helmet: require("../json/helmet.config.json"),
  logger: require("../json/logger.config.json"),
  database: require("../json/database.config.json"),
  imageStore: require("../json/image.config.json"),
  authConfig: require("../json/auth.config.json"),
  storageConfig: require("../json/storage.config.json"),
};

module.exports = {
  ...environment.config,
  ...environment.app,
  ...environment.rateLimiting,
  helmet: environment.helmet,
  ...environment.logger,
  ...environment.database,
  ...environment.imageStore,
  ...environment.authConfig,
  ...environment.storageConfig,
};
