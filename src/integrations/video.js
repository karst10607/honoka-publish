/**
 * Video download integration — download videos via yt-dlp.
 * Clean external addition (no company IP).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Download a video from a URL using yt-dlp.
 * @param {string} url - Video URL (YouTube, Twitter/X, Bilibili, etc.)
 * @param {object} [opts]
 * @param {string} [opts.outputDir] - Download directory
 * @param {function} [opts.onProgress] - Progress callback (percentage string)
 * @returns {Promise<{success: boolean, filename?: string}>}
 */
function downloadVideo(url, opts = {}) {
  const outputDir = opts.outputDir || process.cwd();
  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPattern = path.join(outputDir, `video-${timestamp}-%(title)s.%(ext)s`);

  return new Promise((resolve, reject) => {
    const ytDlpPath = resolveYtDlp();

    const proc = spawn(ytDlpPath, [
      "--no-playlist",
      "--newline",
      "--merge-output-format", "mp4",
      "-o", outputPattern,
      url,
    ]);

    let stderr = "";

    proc.stdout.on("data", (data) => {
      const line = data.toString();
      const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?%)/);
      if (match && opts.onProgress) {
        opts.onProgress(match[1]);
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const files = fs.readdirSync(outputDir);
        const match = files.find((f) => f.startsWith(`video-${timestamp}`));
        resolve({ success: true, filename: match || "Video saved" });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    // Timeout: 10 minutes
    setTimeout(() => {
      proc.kill();
      reject(new Error("yt-dlp timed out after 10 minutes"));
    }, 600000);
  });
}

/**
 * Resolve yt-dlp binary path for the current platform.
 */
function resolveYtDlp() {
  switch (process.platform) {
    case "win32": return "yt-dlp.exe";
    case "darwin": return "/opt/homebrew/bin/yt-dlp";
    default: return "yt-dlp"; // Assume in PATH on Linux
  }
}

module.exports = { downloadVideo };
