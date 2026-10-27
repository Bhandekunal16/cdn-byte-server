function loadCreateExpressApp(overrides = {}) {
  jest.resetModules();
  jest.doMock("../../provider/config.map", () => ({
    ...jest.requireActual("../../provider/config.map"),
    encryption_Interceptor: false,
    logger_interceptor: false,
    response_interceptor: false,
    ...overrides,
  }));

  return require("./createExpressApp");
}

module.exports = { loadCreateExpressApp };
