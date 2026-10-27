const neo4j = require("../provider/dependency.map").neo4j;
const { logByte } = require("../provider/dependency.map");
const { neo4j: neo4jConfig } = require("../provider/config.map");

const { NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_URI } = neo4jConfig;

if (!NEO4J_URI) {
  throw logByte.error("NEO4J_URI is not defined");
}

if (!NEO4J_USERNAME) {
  throw logByte.error("NEO4J_USERNAME is not defined");
}

if (!NEO4J_PASSWORD) {
  throw logByte.error("NEO4J_PASSWORD is not defined");
}

const globalForNeo4j = globalThis;

const neo4jDriver =
  globalForNeo4j._neo4jDriver ||
  neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));

if (process.env.NODE_ENV !== "production") {
  globalForNeo4j._neo4jDriver = neo4jDriver;
}

logByte.info("Neo4j driver initialized");

module.exports = { neo4jDriver };
