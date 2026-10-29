const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const ImageCodec = require("../../../service/image.service");
const StorageService = require("../../../service/storage.service");
const { issueAccessToken } = require("../../../service/access-token.service");
const { ObjectId } = require("../../../provider/dependency.map");
const {
  StorageQuotaExceededError,
} = require("../../../service/storage.service");
const {
  STORAGE_QUOTA_BYTES,
} = require("../../../provider/config.map");
const storageRoutes = require("../../../routes/storage.routes");
const errorInterceptor = require("../../../interceptors/error.interceptor");

const OWNER = { userId: "owner-1", email: "person@gmail.com", role: "user" };
const OTHER_OWNER = { userId: "owner-2", email: "other@gmail.com", role: "user" };
const IMAGE_ID = "6a99b5cec73bdc96e9d4e2eb";

describe("authenticated image routes", () => {
  let readImage;
  let getImageMetaData;
  let deleteImages;
  let encodeForStorage;
  let insertImage;
  let getStorageUsage;

  beforeEach(() => {
    readImage = jest
      .spyOn(StorageService.prototype, "readImage")
      .mockImplementation(async (_id, owner) =>
        owner.userId === OWNER.userId
          ? {
              buffer: Buffer.from("image-data"),
              mimeType: "image/jpeg",
            }
          : undefined,
      );
    getImageMetaData = jest
      .spyOn(StorageService.prototype, "getImageMetaData")
      .mockResolvedValue([{ _id: IMAGE_ID, name: "photo.jpg" }]);
    getStorageUsage = jest
      .spyOn(StorageService.prototype, "getStorageUsage")
      .mockImplementation(async (owner) => ({
        imageCount: owner.userId === OWNER.userId ? 2 : 0,
        usedBytes: owner.userId === OWNER.userId ? 838860800 : 0,
      }));
    deleteImages = jest
      .spyOn(StorageService.prototype, "delete")
      .mockImplementation(async (_ids, owner) => ({
        deletedCount: owner.userId === OWNER.userId ? 1 : 0,
      }));
    encodeForStorage = jest
      .spyOn(ImageCodec.prototype, "encodeForStorage")
      .mockResolvedValue({
        buffer: Buffer.from("encoded-image"),
        mimeType: "image/webp",
        format: "webp",
        width: 10,
        height: 10,
        originalSize: 12,
        storedSize: 13,
        optimized: true,
        checksum: "checksum",
        originalFormat: "png",
        originalMimeType: "image/png",
      });
    insertImage = jest
      .spyOn(StorageService.prototype, "insert")
      .mockResolvedValue({
        acknowledged: true,
        insertedId: new ObjectId(IMAGE_ID),
      });
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

  function authorization(owner = OWNER) {
    return `Bearer ${
      issueAccessToken({
        id: owner.userId,
        email: owner.email,
        role: owner.role,
      }).accessToken
    }`;
  }

  it("rejects image list, upload, download, and delete requests without a token", async () => {
    const app = createApp();

    await request(app).get("/image").expect(401);
    await request(app)
      .post("/image")
      .attach("image", Buffer.from("image"), "photo.png")
      .expect(401);
    await request(app).get(`/image?id=${IMAGE_ID}`).expect(401);
    await request(app).delete("/image").send({ ids: [IMAGE_ID] }).expect(401);

    expect(getImageMetaData).not.toHaveBeenCalled();
    expect(readImage).not.toHaveBeenCalled();
    expect(deleteImages).not.toHaveBeenCalled();
    expect(encodeForStorage).not.toHaveBeenCalled();
  });

  it("requires authentication and reports only the authenticated account's storage usage", async () => {
    const app = createApp();
    await request(app).get("/storage/usage").expect(401);

    const response = await request(app)
      .get("/storage/usage?email=other%40gmail.com")
      .set("Authorization", authorization())
      .expect(200);

    expect(response.body.data).toEqual({
      usedBytes: 838860800,
      quotaBytes: STORAGE_QUOTA_BYTES,
      availableBytes: STORAGE_QUOTA_BYTES - 838860800,
      usagePercentage: 78,
      imageCount: 2,
      warningLevel: "normal",
      idempotencySupported: true,
    });
    expect(getStorageUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER.userId, email: OWNER.email }),
    );
  });

  it("rejects invalid and expired bearer tokens consistently", async () => {
    const app = createApp();
    const expiredToken = jwt.sign(
      { email: OWNER.email, role: OWNER.role },
      process.env.AUTH_TOKEN_SECRET,
      {
        algorithm: "HS256",
        audience: "pixelvault-android",
        expiresIn: -1,
        issuer: "cdn-byte-server",
        subject: OWNER.userId,
      },
    );

    await request(app)
      .get("/image")
      .set("Authorization", "Bearer invalid.token.value")
      .expect(401);
    await request(app)
      .get("/image")
      .set("Authorization", `Bearer ${expiredToken}`)
      .expect(401);

    expect(getImageMetaData).not.toHaveBeenCalled();
  });

  it("lists metadata and reads bytes only in the authenticated owner scope", async () => {
    const app = createApp();

    const list = await request(app)
      .get("/image")
      .set("Authorization", authorization())
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(getImageMetaData).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER.userId, email: OWNER.email }),
    );

    const image = await request(app)
      .get(`/image?id=${IMAGE_ID}`)
      .set("Authorization", authorization())
      .expect(200);
    expect(image.body).toEqual(Buffer.from("image-data"));
    expect(readImage).toHaveBeenCalledWith(
      expect.any(ObjectId),
      expect.objectContaining({ userId: OWNER.userId, email: OWNER.email }),
    );

    await request(app)
      .get(`/image?id=${IMAGE_ID}`)
      .set("Authorization", authorization(OTHER_OWNER))
      .expect(404);
  });

  it("does not allow a caller to request another account's email", async () => {
    await request(createApp())
      .get("/image?email=other%40gmail.com")
      .set("Authorization", authorization())
      .expect(403);

    expect(getImageMetaData).not.toHaveBeenCalled();
  });

  it("derives upload ownership from the authenticated principal", async () => {
    const response = await request(createApp())
      .post("/image")
      .set("Authorization", authorization())
      .attach("image", Buffer.from("image"), "photo.png")
      .expect(200);

    expect(response.body.data.id).toBe(IMAGE_ID);
    expect(insertImage).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          userId: OWNER.userId,
          email: OWNER.email,
        }),
      }),
      STORAGE_QUOTA_BYTES,
    );

    await request(createApp())
      .post("/image")
      .set("Authorization", authorization())
      .field("email", OTHER_OWNER.email)
      .attach("image", Buffer.from("image"), "other.png")
      .expect(403);
  });

  it("passes the idempotency key and returns the original upload response shape", async () => {
    const idempotencyResult = {
      id: IMAGE_ID,
      name: "photo.webp",
      mimeType: "image/webp",
      format: "webp",
      width: 10,
      height: 10,
      originalSize: 12,
      storedSize: 13,
      optimized: true,
      checksum: "checksum",
    };
    insertImage.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(IMAGE_ID),
      idempotencyResult,
      replayed: true,
    });

    const response = await request(createApp())
      .post("/image")
      .set("Authorization", authorization())
      .set("Idempotency-Key", "operation-1234")
      .attach("image", Buffer.from("image"), "photo.png")
      .expect(200);

    expect(response.body.data).toEqual(idempotencyResult);
    expect(insertImage).toHaveBeenCalledWith(
      expect.objectContaining({ owner: expect.objectContaining({ userId: OWNER.userId }) }),
      STORAGE_QUOTA_BYTES,
      "operation-1234",
    );
  });

  it("rejects malformed idempotency keys before processing an upload", async () => {
    await request(createApp())
      .post("/image")
      .set("Authorization", authorization())
      .set("Idempotency-Key", "bad key")
      .attach("image", Buffer.from("image"), "photo.png")
      .expect(400)
      .expect(({ body }) =>
        expect(body.data.errorCode).toBe("IDEMPOTENCY_KEY_INVALID"),
      );

    expect(encodeForStorage).not.toHaveBeenCalled();
    expect(insertImage).not.toHaveBeenCalled();
  });

  it("returns a structured quota rejection distinct from per-file size errors", async () => {
    insertImage.mockRejectedValue(
      new StorageQuotaExceededError({
        usedBytes: STORAGE_QUOTA_BYTES - 1,
        quotaBytes: STORAGE_QUOTA_BYTES,
        requestedBytes: 2,
      }),
    );

    const response = await request(createApp())
      .post("/image")
      .set("Authorization", authorization())
      .attach("image", Buffer.from("image"), "photo.png")
      .expect(409);

    expect(response.body.data).toEqual({
      errorCode: "STORAGE_QUOTA_EXCEEDED",
      usedBytes: STORAGE_QUOTA_BYTES - 1,
      quotaBytes: STORAGE_QUOTA_BYTES,
      availableBytes: 1,
      requestedBytes: 2,
    });
  });

  it("restricts deletion to the authenticated owner", async () => {
    await request(createApp())
      .delete("/image")
      .set("Authorization", authorization())
      .send({ ids: [IMAGE_ID] })
      .expect(200);
    expect(deleteImages).toHaveBeenCalledWith(
      [expect.any(ObjectId)],
      expect.objectContaining({ userId: OWNER.userId }),
    );

    await request(createApp())
      .delete("/image")
      .set("Authorization", authorization(OTHER_OWNER))
      .send({ ids: [IMAGE_ID] })
      .expect(404);
  });
});
