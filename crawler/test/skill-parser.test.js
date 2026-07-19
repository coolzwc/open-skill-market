import assert from "node:assert";
import { test } from "node:test";
import { validateSkillQuality } from "../skill-parser.js";

const validBody = "Detailed skill guidance. ".repeat(30);
const description = "A sufficiently detailed skill description.";

test("validateSkillQuality accepts lowercase slug segments", () => {
  for (const name of ["tweetclaw", "x-twitter-scraper", "tool-2-api"]) {
    assert.deepStrictEqual(
      validateSkillQuality({ name, description }, validBody),
      { isValid: true, reason: "" },
    );
  }
});

test("validateSkillQuality rejects malformed slug separators", () => {
  for (const name of ["bad--name", "-leading", "trailing-", "Uppercase"]) {
    assert.deepStrictEqual(
      validateSkillQuality({ name, description }, validBody),
      {
        isValid: false,
        reason: "Name must use lowercase alphanumeric segments separated by single hyphens",
      },
    );
  }
});
