describe("interceptors/cluster.interceptor.js", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("forks workers on primary and restarts on exit", () => {
    const fork = jest.fn();
    const on = jest.fn();
    const cluster = {
      isPrimary: true,
      fork,
      on,
    };

    jest.resetModules();
    jest.doMock("../../../provider/dependency.map", () => ({
      cluster,
      os: { cpus: () => [1, 2] },
    }));

    const clusterInterceptor = require("../../../interceptors/cluster.interceptor");
    clusterInterceptor();

    expect(fork).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledWith("exit", expect.any(Function));

    const exitHandler = on.mock.calls[0][1];
    exitHandler({ process: { pid: 99 } }, 1, null);
    expect(fork).toHaveBeenCalledTimes(3);
  });

  it("does not refork after markClusterShuttingDown", () => {
    const fork = jest.fn();
    const on = jest.fn();
    const cluster = { isPrimary: true, fork, on };

    jest.resetModules();
    jest.doMock("../../../provider/dependency.map", () => ({
      cluster,
      os: { cpus: () => [1] },
    }));

    const clusterInterceptor = require("../../../interceptors/cluster.interceptor");
    const { markClusterShuttingDown } = require("../../../interceptors/cluster.interceptor");

    clusterInterceptor();
    markClusterShuttingDown();

    const exitHandler = on.mock.calls[0][1];
    exitHandler({ process: { pid: 1 } }, 1, null);

    expect(fork).toHaveBeenCalledTimes(1);
  });
});
