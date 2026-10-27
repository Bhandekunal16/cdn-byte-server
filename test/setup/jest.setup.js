process.env.NODE_ENV = "test";

jest.spyOn(process, "exit").mockImplementation(() => {});

afterEach(() => {
  try {
    const {
      resetShutdownStateForTests,
    } = require("../../layers/graceful.shutdown.layer");
    resetShutdownStateForTests();
  } catch (_) {
    // layer not loaded yet
  }
});
