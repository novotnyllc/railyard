// Read one JSON hook payload from stdin and hand it to `onPayload` exactly
// once. Some runners leave stdin open, so a complete JSON object is handled
// as soon as it arrives instead of waiting for end-of-input or an idle gap.
// Unparseable, oversized, or overdue input yields `undefined`.
function readHookInput(onPayload, { timeoutMs = 3000, maxBytes = 1024 * 1024 } = {}) {
  let raw = "";
  let done = false;
  const finish = (payload) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    process.stdin.destroy(); // release the pipe so the process exits naturally
    onPayload(payload);
  };
  const timer = setTimeout(() => finish(undefined), timeoutMs);
  const attempt = (final) => {
    // A JSON object is complete only once it closes; skip futile parses.
    if (!final && !/}\s*$/.test(raw)) return;
    try { finish(JSON.parse(raw)); } catch { if (final) finish(undefined); }
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (done) return;
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) finish(undefined);
    else attempt(false);
  });
  process.stdin.on("end", () => attempt(true));
  process.stdin.on("error", () => finish(undefined));
}

module.exports = { readHookInput };
