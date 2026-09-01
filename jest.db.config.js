/**
 * DB/authz test project (spec doc 12 §2). Runs against a REAL Postgres:
 *   TEST_DATABASE_URL=postgres://pulso:pulso@localhost:5432/pulso_test npm run test:db
 * CI provides a service container. Separate from the unit suite on purpose.
 */
const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

module.exports = createJestConfig({
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__db"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  testTimeout: 30000,
  maxWorkers: 1,
});
