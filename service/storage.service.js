const asBuffer = require("../core/mongo.functions");
const { BSON, ObjectId } = require("../provider/dependency.map");
const { MONGO_IMAGE_MAX_BYTES, mongodb } = require("../provider/config.map");
const { getDb } = require("../database/mongoDb.service");
const MONGO_BSON_LIMIT = 16 * 1024 * 1024;

class storageService {
  #collectionCache;

  async collection() {
    if (this.#collectionCache) {
      return this.#collectionCache;
    }

    const db = await getDb();

    this.#collectionCache = db.collection(mongodb.DATABASE_COLLECTION.IMAGES);

    return this.#collectionCache;
  }

  async read(email) {
    const collection = await this.collection();
    return collection.find({ email }).toArray();
  }

  async getImageMetaData(email) {
    const collection = await this.collection();

    return collection.find({ email }, { projection: { image: 0 } }).toArray();
  }

  async getStorageUsageByEmail() {
    const collection = await this.collection();

    const users = await collection
      .aggregate([
        {
          $group: {
            _id: "$email",
            imageCount: { $sum: 1 },
            totalStoredSize: {
              $sum: { $ifNull: ["$storedSize", "$size"] },
            },
          },
        },
        {
          $project: {
            _id: 0,
            email: "$_id",
            imageCount: 1,
            totalStoredSize: 1,
          },
        },
        {
          $sort: {
            totalStoredSize: -1,
            email: 1,
          },
        },
      ])
      .toArray();

    return {
      users,
      totalImages: users.reduce((total, user) => total + user.imageCount, 0),
      totalStoredSize: users.reduce(
        (total, user) => total + user.totalStoredSize,
        0,
      ),
    };
  }

  async readImage(id) {
    const collection = await this.collection();

    const image = await collection.findOne(
      { _id: id },
      {
        projection: {
          image: 1,
          mimeType: 1,
          type: 1,
          storedSize: 1,
          checksum: 1,
          _id: 0,
        },
      },
    );

    if (!image) {
      return undefined;
    }

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

    if (encoded.buffer.length > MONGO_IMAGE_MAX_BYTES) {
      throw new Error("Image exceeds the configured MongoDB storage limit");
    }

    const insertDocument = {
      image: encoded.buffer,
      email: document.email,
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

    if (BSON.calculateObjectSize(insertDocument) >= MONGO_BSON_LIMIT) {
      throw new Error("Image document exceeds MongoDB's BSON size limit");
    }

    return collection.insertOne(insertDocument);
  }

  async delete(ids) {
    const collection = await this.collection();

    return collection.deleteMany({
      _id: {
        $in: ids.map((id) => new ObjectId(id)),
      },
    });
  }
}

module.exports = storageService;
