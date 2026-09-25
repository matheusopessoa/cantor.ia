import { execFileSync } from "node:child_process";
import { assertTestDatabase } from "./helpers/database.js";

export default function setup() {
  assertTestDatabase(process.env["DATABASE_URL"]);

  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
}
