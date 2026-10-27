const errorInterceptor = require("../../../interceptors/error.interceptor");

describe("interceptors/error.interceptor.js", () => {
  it("formats error response with current contract", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    errorInterceptor({ message: "boom", status: 404 }, {}, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      message: "boom",
      status: false,
      statusCode: 500,
    });
  });
});
