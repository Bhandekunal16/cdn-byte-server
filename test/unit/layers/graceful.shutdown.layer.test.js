describe("layers/graceful.shutdown.layer.js", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    const { resetShutdownStateForTests } = require("../../../layers/graceful.shutdown.layer");
    resetShutdownStateForTests();
    jest.useRealTimers();
  });

  it("marks shutting down and is idempotent on trigger", () => {
    const { gracefulShutdown, triggerGracefulShutdown, isShuttingDown } =
      require("../../../layers/graceful.shutdown.layer");

    const server = { close: jest.fn() };
    gracefulShutdown({
      server,
      name: "Test",
      shutdownTimeout: 5000,
      activeRequests: new Set(),
    });

    triggerGracefulShutdown("SIGTERM");
    expect(isShuttingDown()).toBe(true);
    triggerGracefulShutdown("SIGTERM");
    expect(isShuttingDown()).toBe(true);
  });

  it("exits 0 after server close and no active requests", async () => {
    jest.useRealTimers();
    const { gracefulShutdown, triggerGracefulShutdown } =
      require("../../../layers/graceful.shutdown.layer");

    const server = {
      close(cb) {
        cb();
      },
    };

    gracefulShutdown({
      server,
      name: "Test",
      shutdownTimeout: 5000,
      activeRequests: new Set(),
    });

    triggerGracefulShutdown("SIGINT");
    await Promise.resolve();

    expect(process.exit).toHaveBeenCalledWith(0);
    jest.useFakeTimers();
  });

  it("exits 1 on shutdown timeout with active requests", () => {
    const { gracefulShutdown, triggerGracefulShutdown } =
      require("../../../layers/graceful.shutdown.layer");

    const server = { close: jest.fn() };
    const active = new Set([{ destroy: jest.fn() }]);

    gracefulShutdown({
      server,
      name: "Test",
      shutdownTimeout: 100,
      activeRequests: active,
    });

    triggerGracefulShutdown("SIGTERM");
    jest.advanceTimersByTime(150);

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
