const fs = require("fs");
const os = require("os");
const path = require("path");

describe("core/file.functions.js", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-logs-"));
    jest.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates logs directory and appends dated file entries", () => {
    const append = require("../../../core/file.functions");

    append(JSON.stringify({ a: 1 }));
    append(JSON.stringify({ b: 2 }));

    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(tmpDir, "logs", `${date}.txt`);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8").trim().split("\n");
    expect(content).toHaveLength(2);
    expect(JSON.parse(content[0])).toEqual({ a: 1 });
  });

  it("throws wrapped error when append fails", () => {
    jest.resetModules();
    jest.spyOn(process, "cwd").mockReturnValue(tmpDir);
    jest.doMock("../../../provider/dependency.map", () => {
      const realFs = require("fs");
      return {
        fs: {
          existsSync: realFs.existsSync,
          mkdirSync: realFs.mkdirSync,
          appendFileSync: () => {
            throw new Error("disk full");
          },
        },
        path: require("path"),
      };
    });

    const append = require("../../../core/file.functions");
    expect(() => append("x")).toThrow("disk full");
  });
});
