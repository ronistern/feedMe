const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const FALLBACK_OPENERS = [
  "You want {food}?",
  "{food}?",
  "So the order is {food}?",
  "{food} for today?",
  "You are asking for {food}?",
  "The official request is {food}?",
  "Let me get this straight: {food}?",
  "We are voting for {food} now?",
  "Kitchen update: {food}?",
  "Your final answer is {food}?",
];
const FALLBACK_CLOSERS = [
  "Bold choice. The kitchen would like a written apology first.",
  "Ambitious. Please alert the fridge so it can emotionally prepare.",
  "Excellent. Now all we need is a tiny miracle and three clean pans.",
  "Big talk from someone not doing the dishes.",
  "Go pitch that idea to the chef and bring snacks for negotiations.",
  "The lunch committee has entered dramatic negotiations.",
  "The stove just asked for a minute to process that.",
  "That request has been forwarded to the Department of Snack Affairs.",
  "A pan somewhere just sighed very loudly.",
  "The chef has marked that down under brave decisions.",
];
const RECENT_REPLY_LIMIT = 10;
const STYLE_HINTS = [
  "Say it like a dramatic TV chef.",
  "Say it like a playful soccer commentator.",
  "Say it like a royal announcement from the kitchen.",
  "Say it like a slightly offended restaurant critic.",
  "Say it like a superhero chef with too much confidence.",
  "Say it like a pirate who runs a lunchroom.",
  "Say it like a game show host revealing a surprise prize.",
  "Say it like a sleepy parent trying to stay funny.",
];
const recentReplies = [];

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

function fallbackCandidates(food) {
  const candidates = [];

  for (const [openerIndex, opener] of FALLBACK_OPENERS.entries()) {
    for (const [closerIndex, closer] of FALLBACK_CLOSERS.entries()) {
      candidates.push({
        key: `fallback-closer:${closerIndex}`,
        text: `${opener.replace("{food}", food)} ${closer}`,
        sortKey: `fallback:${openerIndex}:${closerIndex}`,
      });
    }
  }

  return candidates;
}

function fallbackReply(food) {
  const allCandidates = fallbackCandidates(food);
  const freshCandidates = allCandidates.filter((candidate) => !hasRecentReply(candidate.key));
  const pool = freshCandidates.length ? freshCandidates : allCandidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function randomStyleHint() {
  return STYLE_HINTS[Math.floor(Math.random() * STYLE_HINTS.length)];
}

function normalizeReply(reply) {
  return String(reply || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hasRecentReply(replyOrKey) {
  const normalized = normalizeReply(replyOrKey);
  return recentReplies.some((entry) => entry.key === normalized);
}

function rememberReply(reply, dedupeKey = reply) {
  const normalizedKey = normalizeReply(dedupeKey);
  const normalizedText = normalizeReply(reply);
  if (!normalizedKey || !normalizedText) {
    return;
  }

  recentReplies.push({
    key: normalizedKey,
    text: normalizedText,
  });
  if (recentReplies.length > RECENT_REPLY_LIMIT) {
    recentReplies.shift();
  }
}

function rememberAndReturn(reply, dedupeKey = reply) {
  rememberReply(reply, dedupeKey);
  return reply;
}

async function createCheekyReply(food) {
  if (!OPENAI_API_KEY) {
    const fallback = fallbackReply(food);
    return rememberAndReturn(fallback.text, fallback.key);
  }

  const recentReplyList = recentReplies.length
    ? recentReplies.map((reply) => `- ${reply.text}`).join("\n")
    : "None";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const styleHint = randomStyleHint();

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
                  "You are a playful lunchroom comedian for families. Reply with exactly one short, cheeky sentence about the child's requested food. Keep it funny, light, and family-safe. Do not be cruel, threatening, or insulting. Mention the requested food by name. Use a fresh angle every time and avoid repeating stock phrasing.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  `The child wants to eat: ${food}. ${styleHint}\nAvoid saying anything too similar to these recent replies:\n${recentReplyList}`,
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
    const reply = (payload.output_text || "").trim();

    if (reply && !hasRecentReply(reply)) {
      return rememberAndReturn(reply);
    }
  }

  const fallback = fallbackReply(food);
  return rememberAndReturn(fallback.text, fallback.key);
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
        const fallback = fallbackReply(food);
        sendJson(response, 200, { reply: rememberAndReturn(fallback.text, fallback.key), fallback: true });
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
