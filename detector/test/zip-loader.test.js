/**
 * Self-test: zip-loader getOwnerRepo, zipFilename, and extract from buffer.
 */
import { test } from "node:test";
import assert from "node:assert";
import path from "path";
import AdmZip from "adm-zip";
import { getOwnerRepo, zipFilename } from "../zip-loader.js";

test("getOwnerRepo: valid owner/repo", () => {
  assert.deepStrictEqual(getOwnerRepo({ repo: "owner/repo" }), {
    owner: "owner",
    repo: "repo",
  });
});

test("getOwnerRepo: null for missing or invalid", () => {
  assert.strictEqual(getOwnerRepo({}), null);
  assert.strictEqual(getOwnerRepo({ repo: "" }), null);
  assert.strictEqual(getOwnerRepo({ repo: "single" }), null);
  assert.strictEqual(getOwnerRepo({ repo: "a/b/c" }), null);
});

test("zipFilename: matches crawler format", () => {
  assert.strictEqual(
    zipFilename("owner", "repo", "skill-name"),
    "owner-repo-skill-name.zip"
  );
});

test("loadSkillContent: returns null when skill has no repo", async () => {
  const { loadSkillContent } = await import("../zip-loader.js");
  const out = await loadSkillContent({ id: "x", name: "y", repo: null, path: "z" });
  assert.strictEqual(out, null);
});

test("extract from zip buffer: SKILL.md found", async () => {
  const zip = new AdmZip();
  zip.addFile("my-skill/SKILL.md", Buffer.from("# My Skill\n\nSafe content only.", "utf-8"));
  const buf = zip.toBuffer();
  const zip2 = new AdmZip(buf);
  const entries = zip2.getEntries();
  let skillMd = null;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = e.entryName.replace(/\\/g, "/");
    if (path.basename(name) === "SKILL.md") {
      skillMd = e.getData().toString("utf-8");
      break;
    }
  }
  assert.ok(skillMd);
  assert.ok(skillMd.includes("My Skill"));
});
