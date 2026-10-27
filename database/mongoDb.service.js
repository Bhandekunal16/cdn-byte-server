const {
  MongoClient,
  ServerApiVersion,
  logByte,
} = require("../provider/dependency.map");

const { mongodb } = require("../provider/config.map");

const { MONGODB_URI, MONGO_CONFIG, SERVER_API, DATABASE_NAME } = mongodb;

if (!MONGODB_URI) throw logByte.error("MONGODB_URI is not defined");

if (!DATABASE_NAME) throw logByte.error("DATABASE_NAME is not defined");

const options = {
  ...MONGO_CONFIG,
  serverApi: { ...SERVER_API, version: ServerApiVersion.v1 },
};

let clientPromise;

async function connectAndVerify() {
  const client = new MongoClient(MONGODB_URI, options);

  try {
    await client.connect();
    logByte.info("MongoDB connected successfully");
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function connectWithRetry() {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await connectAndVerify();
    } catch (error) {
      lastError = error;
      logByte.error(`MongoDB connection attempt ${attempt} failed`);
    }
  }

  throw lastError;
}

function getMongoClient() {
  if (!clientPromise) {
    clientPromise = connectWithRetry().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }

  return clientPromise;
}

async function getDb() {
  const client = await getMongoClient();
  return client.db(DATABASE_NAME);
}

module.exports = { getMongoClient, getDb };
