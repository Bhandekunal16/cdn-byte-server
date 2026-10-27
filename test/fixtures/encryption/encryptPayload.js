const crypto = require("crypto");
const appConfig = require("../../../json/app.json");

function encryptJson(payload) {
  const key = crypto.createHash(appConfig.algorithm).update(appConfig.secretKey).digest();
  const iv = Buffer.from(appConfig.randomString);
  const cipher = crypto.createCipheriv(
    appConfig.encryption_algorithm,
    key,
    iv,
  );
  let encrypted = cipher.update(
    JSON.stringify(payload),
    appConfig.Unicode_Transformation_Format,
    appConfig.ENCODED_KEY,
  );
  encrypted += cipher.final(appConfig.ENCODED_KEY);
  return encrypted;
}

module.exports = { encryptJson };
