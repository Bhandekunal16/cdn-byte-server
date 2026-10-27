describe("interceptors/helmet.interceptor.js", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("uses helmet defaults when config object is empty", () => {
    jest.resetModules();
    const helmetMw = jest.fn(() => (req, res, next) => next());
    jest.doMock("../../../provider/dependency.map", () => ({
      helmet: jest.fn(() => helmetMw),
    }));
    jest.doMock("../../../provider/config.map", () => ({ helmet: {} }));

    const helmetInterceptor = require("../../../interceptors/helmet.interceptor");
    const { helmet } = require("../../../provider/dependency.map");
    const app = { use: jest.fn() };

    helmetInterceptor(app);

    expect(helmet).toHaveBeenCalledWith();
    expect(app.use).toHaveBeenCalledWith(helmetMw);
  });

  it("passes custom helmet configuration", () => {
    jest.resetModules();
    const helmetMw = jest.fn(() => (req, res, next) => next());
    const helmetFn = jest.fn(() => helmetMw);
    jest.doMock("../../../provider/dependency.map", () => ({ helmet: helmetFn }));
    jest.doMock("../../../provider/config.map", () => ({
      helmet: { contentSecurityPolicy: false },
    }));

    const helmetInterceptor = require("../../../interceptors/helmet.interceptor");
    const app = { use: jest.fn() };

    helmetInterceptor(app);

    expect(helmetFn).toHaveBeenCalledWith({ contentSecurityPolicy: false });
  });
});
