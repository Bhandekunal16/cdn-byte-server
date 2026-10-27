const { Binary, logByte } = require("../provider/dependency.map");

module.exports = function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Binary) return Buffer.from(value.buffer);
  logByte.error("Stored image binary is invalid");
};
