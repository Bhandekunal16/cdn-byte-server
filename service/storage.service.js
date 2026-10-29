const asBuffer = require("../core/mongo.functions");
const { BSON, ObjectId } = require("../provider/dependency.map");
const {
  MONGO_IMAGE_MAX_BYTES,
  mongodb,
  storageUsagePipeline,
  ImageMetaDataPipe,
  imageDataPipe,
} = require("../provider/config.map");
const { getDb } = require("../database/mongoDb.service");
const MONGO_BSON_LIMIT = 16 * 1024 * 1024;

function ownerFilter(owner) {
  if (!owner?.userId || !owner?.email)
    throw new Error("An authenticated image owner is required");

  return {
    $or: [
      { ownerId: owner.userId },
      { ownerId: { $exists: false }, email: owner.email },
    ],
  };
}

class storageService {
  #collectionCache;

  async collection() {
    if (this.#collectionCache) return this.#collectionCache;
    const db = await getDb();
    this.#collectionCache = db.collection(mongodb.DATABASE_COLLECTION.IMAGES);
    return this.#collectionCache;
  }

  async read(owner) {
    const collection = await this.collection();
    return collection.find(ownerFilter(owner)).toArray();
  }

  async getImageMetaData(owner) {
    const collection = await this.collection();
    return collection.find(ownerFilter(owner), ImageMetaDataPipe).toArray();
  }

  async getStorageUsageByEmail() {
    const collection = await this.collection();
    const users = await collection.aggregate(storageUsagePipeline).toArray();
    return {
      users,
      totalImages: users.reduce((total, user) => total + user.imageCount, 0),
      totalStoredSize: users.reduce(
        (total, user) => total + user.totalStoredSize,
        0,
      ),
    };
  }

  async readImage(id, owner) {
    const collection = await this.collection();

    const image = await collection.findOne(
      { _id: id, ...ownerFilter(owner) },
      imageDataPipe,
    );

    if (!image) return undefined;

    const { mimeType, type, checksum } = image;
    const buffer = asBuffer(image.image);

    return {
      buffer,
      mimeType: mimeType || type || "application/octet-stream",
      storedSize: buffer.length,
      checksum,
    };
  }

  async insert(document) {
    const collection = await this.collection();
    const encoded = document.encoded;

    if (encoded.buffer.length > MONGO_IMAGE_MAX_BYTES)
      throw new Error("Image exceeds the configured MongoDB storage limit");

    const insertDocument = {
      image: encoded.buffer,
      email: document.owner.email,
      ownerId: document.owner.userId,
      name: document.name,
      type: encoded.mimeType,
      size: encoded.storedSize,
      format: encoded.format,
      mimeType: encoded.mimeType,
      width: encoded.width,
      height: encoded.height,
      originalSize: encoded.originalSize,
      storedSize: encoded.storedSize,
      optimized: encoded.optimized,
      checksum: encoded.checksum,
      originalFormat: encoded.originalFormat,
      originalMimeType: encoded.originalMimeType,
      createdAt: new Date(),
    };

    if (BSON.calculateObjectSize(insertDocument) >= MONGO_BSON_LIMIT)
      throw new Error("Image document exceeds MongoDB's BSON size limit");

    return collection.insertOne(insertDocument);
  }

  async delete(ids, owner) {
    const collection = await this.collection();

    return collection.deleteMany({
      _id: {
        $in: ids.map((id) => new ObjectId(id)),
      },
      ...ownerFilter(owner),
    });
  }
}

module.exports = storageService;
