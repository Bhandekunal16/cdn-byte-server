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
      statusCode: 404,
    });
  });

  it("passes errors onward when response headers have already been sent", () => {
    const error = new Error("stream failed");
    const next = jest.fn();
    const res = {
      headersSent: true,
      status: jest.fn(),
      json: jest.fn(),
    };

    errorInterceptor(error, {}, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
