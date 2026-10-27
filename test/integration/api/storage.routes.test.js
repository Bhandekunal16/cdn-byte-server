const express = require("express");
const request = require("supertest");
const { storageService } = require("../../../service/storage.service");
const storageRoutes = require("../../../routes/storage.routes");
const errorInterceptor = require("../../../interceptors/error.interceptor");

describe("image retrieval routes", () => {
  let readImage;
  let getImageMetaData;

  beforeEach(() => {
    readImage = jest
      .spyOn(storageService.prototype, "readImage")
      .mockResolvedValue({
        buffer: Buffer.from("image-data"),
        mimeType: "image/jpeg",
      });
    getImageMetaData = jest
      .spyOn(storageService.prototype, "getImageMetaData")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    storageRoutes(app);
    app.use(errorInterceptor);
    return app;
  }

  it("ends the ID lookup after sending the image bytes", async () => {
    const response = await request(createApp())
      .get("/image?id=6a99b5cec73bdc96e9d4e2eb")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(response.body).toEqual(Buffer.from("image-data"));
    expect(readImage).toHaveBeenCalledTimes(1);
    expect(getImageMetaData).not.toHaveBeenCalled();
  });

  it("returns immediately when the requested image does not exist", async () => {
    readImage.mockResolvedValueOnce(undefined);

    const response = await request(createApp())
      .get("/image?id=6a99b5cec73bdc96e9d4e2eb")
      .expect(404);

    expect(response.body.message).toBe("Image not found");
    expect(getImageMetaData).not.toHaveBeenCalled();
  });
});
