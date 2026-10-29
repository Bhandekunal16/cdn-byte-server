jest.mock("../../../database/mongoDb.service", () => ({
  getDb: jest.fn(),
}));

const { ObjectId } = require("mongodb");
const { getDb } = require("../../../database/mongoDb.service");
const StorageService = require("../../../service/storage.service");
const { ImageMetaDataPipe } = require("../../../provider/config.map");

const owner = { userId: "user-123", email: "person@gmail.com" };
const legacyOwnerFilter = {
  $or: [
    { ownerId: owner.userId },
    { ownerId: { $exists: false }, email: owner.email },
  ],
};

describe("storage service image ownership", () => {
  let collection;

  beforeEach(() => {
    collection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    getDb.mockResolvedValue({
      collection: jest.fn().mockReturnValue(collection),
    });
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

    expect(collection.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [new ObjectId(id)] },
      ...legacyOwnerFilter,
    });
  });

  it("stores stable owner ID for newly uploaded records", async () => {
    const encoded = {
      buffer: Buffer.from("image-data"),
      mimeType: "image/webp",
      format: "webp",
      storedSize: 10,
      originalSize: 10,
    };
    await new StorageService().insert({ encoded, owner, name: "photo.webp" });

    const [document] = collection.insertOne.mock.calls[0];
    expect(document).toMatchObject({
      ownerId: owner.userId,
      email: owner.email,
      name: "photo.webp",
    });
  });
});
