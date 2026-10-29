process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET =
  "jest-only-signing-key-never-use-outside-tests-0123456789";

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
