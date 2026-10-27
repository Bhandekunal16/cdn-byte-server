const path = require("path");

function loadMiddlewareLoader(config) {
  jest.resetModules();

  const stubs = {
    requestIdInterceptor: jest.fn((req, res, next) => next()),
    helmetInterceptor: jest.fn((app) => app.use(jest.fn((req, res, next) => next()))),
    encryptionInterceptor: jest.fn((req, res, next) => next()),
    loggerInterceptor: jest.fn((req, res, next) => next()),
    responseInterceptor: jest.fn((req, res, next) => next()),
    errorInterceptors: jest.fn(),
  };

  jest.doMock(path.join(__dirname, "../../provider/config.map"), () => config);
  jest.doMock(path.join(__dirname, "../../provider/interceptor.map"), () => ({
    ...stubs,
    clusterInterceptor: jest.fn(),
    markClusterShuttingDown: jest.fn(),
  }));
  jest.doMock(path.join(__dirname, "../../provider/dependency.map"), () => {
    const express = require("express");
    return { express, cors: () => (req, res, next) => next() };
  });

  const loader = require("../../middleware.loader");
  return { loader, stubs };
}

describe("middleware.loader.js", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("registers middleware in order when all flags enabled", () => {
    const { loader, stubs } = loadMiddlewareLoader({
      requestId: true,
      helmet_interceptor: true,
      encryption_Interceptor: true,
      logger_interceptor: true,
      response_interceptor: true,
      errorInterceptor: true,
    });

    const use = jest.fn();
    const app = { use };

    loader.middleware(app);

    expect(stubs.requestIdInterceptor).toBeDefined();
    expect(use.mock.calls[0][0]).toBe(stubs.requestIdInterceptor);
    expect(stubs.helmetInterceptor).toHaveBeenCalledWith(app);
    expect(use).toHaveBeenCalledWith(stubs.encryptionInterceptor);
    expect(use).toHaveBeenCalledWith(stubs.loggerInterceptor);
    expect(use).toHaveBeenCalledWith(stubs.responseInterceptor);

    const rateLimitMw = use.mock.calls.find(
      (call) => typeof call[0] === "function" && call[0].name === "rateLimiter",
    );
    expect(rateLimitMw).toBeUndefined();
  });

  it("skips optional middleware when flags disabled", () => {
    const { loader, stubs } = loadMiddlewareLoader({
      requestId: false,
      helmet_interceptor: false,
      encryption_Interceptor: false,
      logger_interceptor: false,
      response_interceptor: false,
      errorInterceptor: false,
    });

    const app = { use: jest.fn() };
    loader.middleware(app);

    expect(stubs.helmetInterceptor).not.toHaveBeenCalled();
    expect(app.use).not.toHaveBeenCalledWith(stubs.encryptionInterceptor);
    expect(app.use.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("registers error middleware only when enabled", () => {
    const enabled = loadMiddlewareLoader({
      errorInterceptor: true,
      requestId: false,
      helmet_interceptor: false,
      encryption_Interceptor: false,
      logger_interceptor: false,
      response_interceptor: false,
    });
    const disabled = loadMiddlewareLoader({
      errorInterceptor: false,
      requestId: false,
      helmet_interceptor: false,
      encryption_Interceptor: false,
      logger_interceptor: false,
      response_interceptor: false,
    });

    const app1 = { use: jest.fn() };
    enabled.loader.errorMiddleware(app1);
    expect(app1.use).toHaveBeenCalledWith(enabled.stubs.errorInterceptors);

    const app2 = { use: jest.fn() };
    disabled.loader.errorMiddleware(app2);
    expect(app2.use).not.toHaveBeenCalled();
  });
});
