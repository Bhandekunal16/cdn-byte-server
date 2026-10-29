jest.mock("../../../database/mongoDb.service", () => ({
  getDb: jest.fn(),
}));

const { ObjectId } = require("mongodb");
const { getDb } = require("../../../database/mongoDb.service");
const StorageService = require("../../../service/storage.service");
const {
  ImageMetaDataPipe,
  STORAGE_QUOTA_BYTES,
  storageUsagePipeline,
} = require("../../../provider/config.map");

const owner = { userId: "user-123", email: "person@gmail.com" };
const legacyOwnerFilter = {
  $or: [
    { ownerId: owner.userId },
    { ownerId: { $exists: false }, email: owner.email },
  ],
};

describe("storage service image ownership", () => {
  let collection;
  let lockCollection;
  let idempotencyCollection;
  let idempotencyRecords;
  let session;
  let db;

  beforeEach(() => {
    session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    collection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    };
    lockCollection = { updateOne: jest.fn().mockResolvedValue({}) };
    idempotencyRecords = new Map();
    idempotencyCollection = {
      findOne: jest.fn(async ({ _id }) => idempotencyRecords.get(_id) ?? null),
      insertOne: jest.fn(async (record) => {
        idempotencyRecords.set(record._id, record);
        return { acknowledged: true };
      }),
    };
    db = {
      client: { startSession: jest.fn(() => session) },
      collection: jest.fn((name) => {
        if (name === "image_quota_locks") return lockCollection;
        if (name === "image_upload_idempotency") return idempotencyCollection;
        return collection;
      }),
    };
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("scopes metadata queries to the principal and legacy-owned records", async () => {
    await new StorageService().getImageMetaData(owner);

    expect(collection.find).toHaveBeenCalledWith(
      legacyOwnerFilter,
      ImageMetaDataPipe,
    );
  });

  it("scopes binary reads to the image ID and authenticated owner", async () => {
    const id = new ObjectId("6a99b5cec73bdc96e9d4e2eb");
    await new StorageService().readImage(id, owner);

    expect(collection.findOne).toHaveBeenCalledWith(
      { _id: id, ...legacyOwnerFilter },
      expect.any(Object)
    );
  });

  it("scopes bulk deletion to the authenticated owner", async () => {
    const id = "6a99b5cec73bdc96e9d4e2eb";
    await new StorageService().delete([id], owner);

    expect(collection.deleteMany).toHaveBeenCalledWith(
      {
        _id: { $in: [new ObjectId(id)] },
        ...legacyOwnerFilter,
      },
      { session },
    );
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
  });

  it("stores stable owner ID for newly uploaded records in a quota transaction", async () => {
    const encoded = {
      buffer: Buffer.from("image-data"),
      mimeType: "image/webp",
      format: "webp",
      storedSize: 10,
      originalSize: 10,
    };
    await new StorageService().insert(
      { encoded, owner, name: "photo.webp" },
      STORAGE_QUOTA_BYTES,
    );

    const [document] = collection.insertOne.mock.calls[0];
    expect(document).toMatchObject({
      ownerId: owner.userId,
      email: owner.email,
      name: "photo.webp",
    });
    expect(collection.insertOne).toHaveBeenCalledWith(document, { session });
    expect(lockCollection.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: owner.userId },
      { $inc: { revision: 1 } },
      { session },
    );
  });

  it("rejects an upload that would exceed quota and never inserts it", async () => {
    collection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { imageCount: 1, totalStoredSize: 9, invalidSizeCount: 0 },
      ]),
    });
    const encoded = {
      buffer: Buffer.from("12"),
      mimeType: "image/webp",
      format: "webp",
      storedSize: 2,
      originalSize: 2,
    };

    await expect(
      new StorageService().insert(
        { encoded, owner, name: "too-large.webp" },
        10,
      ),
    ).rejects.toMatchObject({
      name: "StorageQuotaExceededError",
      usedBytes: 9,
      quotaBytes: 10,
      availableBytes: 1,
      requestedBytes: 2,
    });
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  it("accepts an upload exactly at the quota boundary", async () => {
    collection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { imageCount: 1, totalStoredSize: 8, invalidSizeCount: 0 },
      ]),
    });
    const encoded = {
      buffer: Buffer.from("12"),
      mimeType: "image/webp",
      format: "webp",
      storedSize: 2,
      originalSize: 2,
    };

    await new StorageService().insert(
      { encoded, owner, name: "boundary.webp" },
      10,
    );

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
  });

  it("replays the original upload result without consuming quota twice", async () => {
    collection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const encoded = {
      buffer: Buffer.from("same-image"),
      mimeType: "image/webp",
      format: "webp",
      storedSize: 10,
      originalSize: 10,
      checksum: "same-checksum",
    };
    const service = new StorageService();
    const document = { encoded, owner, name: "photo.webp" };

    const first = await service.insert(document, 100, "operation-1234");
    const replay = await service.insert(document, 100, "operation-1234");

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      acknowledged: true,
      insertedId: first.insertedId,
      idempotencyResult: first.idempotencyResult,
      replayed: true,
    });
    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(collection.aggregate).toHaveBeenCalledTimes(1);
    expect(idempotencyCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of an upload idempotency key for different content", async () => {
    collection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const service = new StorageService();

    await service.insert(
      {
        encoded: {
          buffer: Buffer.from("first-image"),
          mimeType: "image/webp",
          format: "webp",
          storedSize: 10,
          originalSize: 10,
        },
        owner,
        name: "first.webp",
      },
      100,
      "operation-1234",
    );

    await expect(
      service.insert(
        {
          encoded: {
            buffer: Buffer.from("different-image"),
            mimeType: "image/webp",
            format: "webp",
            storedSize: 15,
            originalSize: 15,
          },
          owner,
          name: "different.webp",
        },
        100,
        "operation-1234",
      ),
    ).rejects.toMatchObject({ name: "IdempotencyKeyConflictError" });
    expect(collection.insertOne).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent uploads with the same idempotency key", async () => {
    let transactionTail = Promise.resolve();
    db.client.startSession.mockImplementation(() => ({
      withTransaction: async (callback) => {
        const previous = transactionTail;
        let release;
        transactionTail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          await callback();
        } finally {
          release();
        }
      },
      endSession: jest.fn().mockResolvedValue(undefined),
    }));
    collection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const service = new StorageService();
    const document = {
      encoded: {
        buffer: Buffer.from("same-image"),
        mimeType: "image/webp",
        format: "webp",
        storedSize: 10,
        originalSize: 10,
      },
      owner,
      name: "photo.webp",
    };

    const outcomes = await Promise.all([
      service.insert(document, 100, "operation-1234"),
      service.insert(document, 100, "operation-1234"),
    ]);

    expect(outcomes.map((outcome) => outcome.insertedId.toString())).toEqual([
      outcomes[0].insertedId.toString(),
      outcomes[0].insertedId.toString(),
    ]);
    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(idempotencyCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(collection.aggregate).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent uploads so they cannot consume the same remaining quota", async () => {
    let storedImages = [];
    let transactionTail = Promise.resolve();
    db.client.startSession.mockImplementation(() => ({
      withTransaction: async (callback) => {
        const previous = transactionTail;
        let release;
        transactionTail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          await callback();
        } finally {
          release();
        }
      },
      endSession: jest.fn().mockResolvedValue(undefined),
    }));
    collection.aggregate.mockImplementation(() => ({
      toArray: async () =>
        storedImages.length
          ? [{
              imageCount: storedImages.length,
              totalStoredSize: storedImages.reduce(
                (total, image) => total + image.storedSize,
                0,
              ),
              invalidSizeCount: 0,
            }]
          : [],
    }));
    collection.insertOne.mockImplementation(async (document) => {
      storedImages.push(document);
      return { acknowledged: true };
    });
    const encoded = {
      buffer: Buffer.from("sixsix"),
      mimeType: "image/webp",
      format: "webp",
      storedSize: 6,
      originalSize: 6,
    };
    const service = new StorageService();

    const outcomes = await Promise.allSettled([
      service.insert({ encoded, owner, name: "first.webp" }, 10),
      service.insert({ encoded, owner, name: "second.webp" }, 10),
    ]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(storedImages).toHaveLength(1);
  });

  it("fails usage instead of treating invalid size metadata as zero", async () => {
    collection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { imageCount: 1, totalStoredSize: 0, invalidSizeCount: 1 },
      ]),
    });

    await expect(new StorageService().getStorageUsage(owner)).rejects.toThrow(
      "no valid storedSize or legacy size",
    );
  });

  it("returns usage for every record matched to an owner, across email changes", async () => {
    collection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { imageCount: 2, totalStoredSize: 15, invalidSizeCount: 0 },
      ]),
    });

    await expect(new StorageService().getStorageUsage(owner)).resolves.toEqual({
      imageCount: 2,
      usedBytes: 15,
    });

    const [pipeline] = collection.aggregate.mock.calls[0];
    expect(pipeline[0]).toEqual({ $match: legacyOwnerFilter });
    expect(pipeline[1]).toBe(storageUsagePipeline[0]);
    expect(pipeline[2].$group._id).toBeNull();
  });

  it("projects invalid-size counts for administrative usage aggregation", () => {
    const projectStage = storageUsagePipeline.find((stage) => stage.$project);

    expect(projectStage.$project.invalidSizeCount).toBe(1);
  });
});
