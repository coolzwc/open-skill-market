/**
 * Download repo zipball with size limit and extract to temp directory.
 * Used when a repo has many skills (> archiveDownloadMinSkills) and zip < archiveMaxZipSizeBytes.
 */
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { CONFIG, __crawlerDirname } from "../config.js";
const TMP_EXTRACT_BASE = path.join(__crawlerDirname, ".tmp-extract");

/**
 * Stream-download repo zipball; abort if size exceeds maxBytes.
 * Uses Core API (1 request). Updates client rate limit from response headers.
 * @param {import("../worker-pool.js").WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref - Branch, tag, or commit SHA
 * @param {number} maxBytes - Abort and return exceededLimit if response body exceeds this
 * @returns {Promise<{ buffer?: Buffer, exceededLimit: boolean, error?: string }>}
 */
export async function downloadRepoArchiveWithSizeLimit(
  workerPool,
  owner,
  repo,
  ref,
  maxBytes,
) {
  const client = workerPool.getClient();
  try {
    const response = await client.octokit.request(
      "GET /repos/{owner}/{repo}/zipball/{ref}",
      {
        owner,
        repo,
        ref,
        request: {
          parseSuccessResponseBody: false,
          timeout: CONFIG.execution?.requestTimeout ?? 30000,
        },
      },
    );

    if (response?.headers) {
      workerPool.updateClientRateLimit(client, response);
    }

    const body = response.data;
    if (!body) {
      return { exceededLimit: false, error: "Empty response body" };
    }
    if (Buffer.isBuffer(body)) {
      if (body.length > maxBytes) {
        return { exceededLimit: true };
      }
      return { buffer: body, exceededLimit: false };
    }

    // Web ReadableStream (fetch/Octokit v5): use getReader()
    if (typeof body.getReader === "function") {
      const chunks = [];
      let totalLength = 0;
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          totalLength += chunk.length;
          if (totalLength > maxBytes) {
            reader.cancel().catch(() => {});
            return { exceededLimit: true };
          }
          chunks.push(chunk);
        }
        return {
          buffer: Buffer.concat(chunks),
          exceededLimit: false,
        };
      } catch (streamErr) {
        return {
          exceededLimit: false,
          error: streamErr.message || String(streamErr),
        };
      }
    }

    // Node.js stream (has .on): collect chunks and abort if over limit
    if (typeof body.on === "function") {
      const chunks = [];
      let totalLength = 0;
      let overflow = false;
      const stream = body;
      const onData = (chunk) => {
        if (overflow) return;
        totalLength += chunk.length;
        if (totalLength > maxBytes) {
          overflow = true;
          if (typeof stream.destroy === "function") stream.destroy();
        } else {
          chunks.push(chunk);
        }
      };
      await new Promise((resolve, reject) => {
        stream.on("data", onData);
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });

      if (overflow || totalLength > maxBytes) {
        return { exceededLimit: true };
      }
      return {
        buffer: Buffer.concat(chunks),
        exceededLimit: false,
      };
    }

    return {
      exceededLimit: false,
      error: "Unsupported response body type (expected Buffer, ReadableStream, or Node stream)",
    };
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      if (error.response?.headers) {
        workerPool.updateClientRateLimit(client, error.response);
      }
      client.core.isLimited = true;
    }
    return {
      exceededLimit: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Extract zip buffer to a temp directory and return the single top-level folder path
 * (GitHub zipball format: root is "owner-repo-<sha>/").
 * @param {Buffer} buffer - Zip file buffer
 * @returns {Promise<{ extractRoot: string, extractDir: string }>} extractRoot is the full path to the single top-level dir; extractDir is the temp dir (for cleanup)
 */
export async function extractZipToTemp(buffer) {
  await fs.mkdir(TMP_EXTRACT_BASE, { recursive: true });
  const dirId = randomUUID();
  const extractDir = path.join(TMP_EXTRACT_BASE, dirId);
  await fs.mkdir(extractDir, { recursive: true });

  const zip = new AdmZip(buffer);
  zip.extractAllTo(extractDir, true);

  const entries = zip.getEntries();
  if (entries.length === 0) {
    await fs.rm(extractDir, { recursive: true, force: true });
    throw new Error("Archive is empty");
  }

  const firstEntry = entries[0];
  const firstPath = firstEntry.entryName.replace(/\\/g, "/");
  const topLevel = firstPath.split("/")[0];
  const extractRoot = path.join(extractDir, topLevel);

  try {
    await fs.access(extractRoot);
  } catch {
    await fs.rm(extractDir, { recursive: true, force: true });
    throw new Error(`Archive top-level folder not found: ${topLevel}`);
  }

  return { extractRoot, extractDir };
}

/**
 * Remove temp extract directory and optionally clear all .tmp-extract contents.
 * @param {string} extractDir - Full path to the extract dir (e.g. .tmp-extract/uuid)
 */
export async function removeExtractDir(extractDir) {
  try {
    await fs.rm(extractDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`  Failed to remove extract dir ${extractDir}: ${err.message}`);
  }
}

/**
 * Clean all .tmp-extract directory (call at end of run).
 */
export async function cleanupAllExtracts() {
  try {
    await fs.rm(TMP_EXTRACT_BASE, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`  Failed to cleanup .tmp-extract: ${err.message}`);
    }
  }
}
