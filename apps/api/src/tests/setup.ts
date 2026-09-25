import { beforeEach, afterAll } from "vitest";
import { prisma } from "../utils/prisma.js";
import { truncateAllTables } from "./helpers/database.js";

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});
