import type { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { MongoService, dbNameFromUri } from "./mongo.service";

function makeConfig(uri: string): ConfigService<Env, true> {
  return {
    get: (key: string) => {
      if (key !== "MONGODB_CONNECT") {
        throw new Error(`Unexpected config key: ${key}`);
      }
      return uri;
    },
  } as unknown as ConfigService<Env, true>;
}

describe("dbNameFromUri", () => {
  it.each([
    ["mongodb://localhost:27017/mydb", "mydb"],
    ["mongodb+srv://u:p@cluster.mongodb.net/command_center", "command_center"],
    ["mongodb+srv://u:p@cluster.mongodb.net/db?retryWrites=true", "db"],
    ["mongodb://h1:27017,h2:27017/replset-db?replicaSet=rs0", "replset-db"],
    ["mongodb://localhost:27017/my%20db", "my db"],
  ])("extracts the db name from %s", (uri, expected) => {
    expect(dbNameFromUri(uri)).toBe(expected);
  });

  it.each([
    "mongodb+srv://u:p@cluster.mongodb.net",
    "mongodb+srv://u:p@cluster.mongodb.net/",
    "mongodb://localhost:27017/?directConnection=true",
  ])("returns undefined when %s has no db in its path", (uri) => {
    expect(dbNameFromUri(uri)).toBeUndefined();
  });
});

describe("MongoService", () => {
  // MongoClient connects lazily, so constructing the service and resolving
  // collections is safe without a running MongoDB.
  it("uses the database named in the connection string", () => {
    const service = new MongoService(
      makeConfig("mongodb://localhost:27017/custom_db"),
    );
    expect(service.collection("things").dbName).toBe("custom_db");
  });

  it("falls back to command_center when the URI has no database path", () => {
    const service = new MongoService(makeConfig("mongodb://localhost:27017/"));
    expect(service.collection("things").dbName).toBe("command_center");
  });

  it("hands out collections by name", () => {
    const service = new MongoService(makeConfig("mongodb://localhost:27017/x"));
    expect(service.collection("braindump_notes").collectionName).toBe(
      "braindump_notes",
    );
  });
});
