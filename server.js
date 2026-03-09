const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const FALLBACK_LINES = [
  "You want {food}? Bold choice. The kitchen would like a written apology first.",
  "{food}? Ambitious. Please alert the fridge so it can emotionally prepare.",
  "You want {food}? Excellent. Now all we need is a tiny miracle and three clean pans.",
  "{food}? Big talk from someone not doing the dishes.",
  "You want {food}? Go pitch that idea to the chef and bring snacks for negotiations.",
];

function getStaticFilePath(urlPath) {
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const resolved = path.resolve(__dirname, relativePath);
  if (!resolved.startsWith(__dirname)) {
    return null;
  }
  return resolved;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": MIME_TYPES[".json"],
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function fallbackReply(food) {
  const line = FALLBACK_LINES[Math.floor(Math.random() * FALLBACK_LINES.length)];
  return line.replace("{food}", food);
}

async function createCheekyReply(food) {
  if (!OPENAI_API_KEY) {
    return fallbackReply(food);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are a playful lunchroom comedian for families. Reply with exactly one short, cheeky sentence about the child's requested food. Keep it funny, light, and family-safe. Do not be cruel, threatening, or insulting. Mention the requested food by name.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `The child wants to eat: ${food}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  return payload.output_text || fallbackReply(food);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "POST" && url.pathname === "/api/cheeky-response") {
      const body = await readRequestBody(request);
      const parsed = JSON.parse(body || "{}");
      const food = String(parsed.food || "").trim().slice(0, 60);

      if (!food) {
        sendJson(response, 400, { error: "Food is required." });
        return;
      }

      try {
        const reply = await createCheekyReply(food);
        sendJson(response, 200, { reply });
      } catch (error) {
        sendJson(response, 200, { reply: fallbackReply(food), fallback: true });
      }
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const filePath = getStaticFilePath(url.pathname);
    if (!filePath) {
      sendJson(response, 403, { error: "Forbidden." });
      return;
    }

    const extension = path.extname(filePath);
    const mimeType = MIME_TYPES[extension] || "text/plain; charset=utf-8";
    const fileContents = await fs.readFile(filePath);

    response.writeHead(200, { "Content-Type": mimeType });
    response.end(fileContents);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    sendJson(response, 500, { error: "Server error." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FeedMe Today running at http://${HOST}:${PORT}`);
});
