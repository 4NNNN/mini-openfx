import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

// Database connection — bun:sqlite + Drizzle ORM

const DB_PATH = "./data/mini-openfx.db";

// Ensure data directory exists
import { mkdirSync } from "fs";
import { dirname } from "path";
mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
export { sqlite };
