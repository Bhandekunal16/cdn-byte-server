const path = require("path");

describe("provider/config.map.js", () => {
  const configMapPath = path.join(__dirname, "../../../provider/config.map.js");

  it("loads merged configuration from json sources", () => {
    const config = require(configMapPath);

    expect(config.errorInterceptor).toBeDefined();
    expect(config.host).toBeDefined();
    expect(config.port).toBeDefined();
    expect(config.windowMs).toBeDefined();
    expect(config.limit).toBeDefined();
    expect(config.exclude).toBeDefined();
    expect(config.WRITE_L0G).toBeDefined();
    expect(config.helmet).toBeDefined();
    expect(typeof config.helmet).toBe("object");
  });

  it("applies app.json over config.json on key collision", () => {
    jest.resetModules();
    jest.doMock("../../../json/config.json", () => ({
      port: 1111,
      collisionKey: "fromConfig",
    }));
    jest.doMock("../../../json/app.json", () => ({
      port: 2222,
      collisionKey: "fromApp",
      host: "127.0.0.1",
    }));
    jest.doMock("../../../json/rate-limiting.config.json", () => ({
      windowMs: 1,
      limit: 1,
    }));
    jest.doMock("../../../json/helmet.config.json", () => ({}));
    jest.doMock("../../../json/logger.config.json", () => ({
      exclude: [],
      WRITE_L0G: false,
    }));

    const merged = require(configMapPath);
    expect(merged.port).toBe(2222);
    expect(merged.collisionKey).toBe("fromApp");
    expect(merged.helmet).toEqual({});
  });

  it("keeps helmet nested and applies logger spread after rate limit", () => {
    jest.resetModules();
    jest.doMock("../../../json/config.json", () => ({}));
    jest.doMock("../../../json/app.json", () => ({ host: "0.0.0.0" }));
    jest.doMock("../../../json/rate-limiting.config.json", () => ({
      sharedKey: "rate",
      limit: 5,
    }));
    jest.doMock("../../../json/helmet.config.json", () => ({
      contentSecurityPolicy: false,
    }));
    jest.doMock("../../../json/logger.config.json", () => ({
      sharedKey: "logger",
      exclude: ["body"],
    }));

    const merged = require(configMapPath);
    expect(merged.helmet).toEqual({ contentSecurityPolicy: false });
    expect(merged.sharedKey).toBe("logger");
    expect(merged.contentSecurityPolicy).toBeUndefined();
  });
});
