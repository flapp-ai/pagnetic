import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PAGNETIC_RECORDER_PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const server = createServer(async (request, response) => {
  if (request.method !== "GET" || !["/", "/index.html"].includes(request.url)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  try {
    const path = normalize(join(root, "index.html"));
    const body = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] });
    response.end(body);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Recorder unavailable");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pagnetic recorder listening at http://127.0.0.1:${port}/`);
  console.log("Stop with Ctrl-C. No video is uploaded or stored by this server.");
});
