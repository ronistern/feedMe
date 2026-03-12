const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_FILE = path.join(__dirname, "data", "requests.json");
const DATA_TEMPLATE = {
  requests: [],
};
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    })
  : null;

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
const FALLBACK_SNOTTY_REMARKS = [
  "Again? Your menu strategy has the range of a broken toaster.",
  "Yesterday's request called and asked for a little breathing room.",
  "You really looked at the full universe of food and picked the rerun.",
  "A fearless commitment to zero culinary plot twists.",
  "The kitchen noticed this is less a request and more a sequel.",
  "Remarkable consistency. Terrible suspense.",
  "Even the leftovers were hoping for a new idea today.",
  "You are treating the menu like it only has one page.",
  "Bold to submit the director's cut of yesterday's request.",
  "The pantry appreciates your loyalty, if not your imagination.",
  "That choice is so familiar it already knows where the plates live.",
  "Your request has achieved the rare honor of being pre-owned.",
  "Stunning dedication to the food version of a replay button.",
  "The chef was hoping for innovation and got a remastered classic.",
  "This request feels less new and more syndicated.",
  "At this rate, the menu can file for routine status.",
  "The fridge recognized this order before I finished reading it.",
  "Congratulations on turning lunch into a long-running franchise.",
  "This meal request has officially entered its repeat era.",
  "Fresh day, same headline. The kitchen noticed.",
];
const recentReplies = [];
let databaseInitializationPromise = null;

async function ensureDataFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(DATA_TEMPLATE, null, 2));
  }
}

async function initializeDatabase() {
  if (!pool) {
    return;
  }

  if (!databaseInitializationPromise) {
    databaseInitializationPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        child_name TEXT NOT NULL,
        name TEXT NOT NULL,
        meal_type TEXT NOT NULL,
        reply_source TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT,
        reply TEXT NOT NULL,
        snotty_remark TEXT NOT NULL,
        repeated_from_yesterday BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'active',
        archived_at BIGINT
      )
    `);
  }

  await databaseInitializationPromise;
}

function mapRowToRequest(row) {
  return {
    id: row.id,
    childName: row.child_name,
    name: row.name,
    mealType: row.meal_type,
    replySource: row.reply_source,
    createdAt: Number(row.created_at),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
    reply: row.reply,
    snottyRemark: row.snotty_remark,
    repeatedFromYesterday: Boolean(row.repeated_from_yesterday),
    status: row.status,
    archivedAt: row.archived_at == null ? null : Number(row.archived_at),
  };
}

async function loadRequestRecords() {
  if (!pool) {
    const data = await readData();
    return data.requests.map(sanitizeRequest);
  }

  await initializeDatabase();
  const result = await pool.query(
    `SELECT
      id,
      child_name,
      name,
      meal_type,
      reply_source,
      created_at,
      updated_at,
      reply,
      snotty_remark,
      repeated_from_yesterday,
      status,
      archived_at
    FROM requests`
  );

  return result.rows.map(mapRowToRequest).map(sanitizeRequest);
}

async function insertRequestRecord(record) {
  if (!pool) {
    const data = await readData();
    data.requests.push(record);
    await writeData(data);
    return;
  }

  await initializeDatabase();
  await pool.query(
    `INSERT INTO requests (
      id,
      child_name,
      name,
      meal_type,
      reply_source,
      created_at,
      updated_at,
      reply,
      snotty_remark,
      repeated_from_yesterday,
      status,
      archived_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      record.id,
      record.childName,
      record.name,
      record.mealType,
      record.replySource,
      record.createdAt,
      record.updatedAt,
      record.reply,
      record.snottyRemark,
      record.repeatedFromYesterday,
      record.status,
      record.archivedAt,
    ]
  );
}

async function saveUpdatedRequestRecord(record) {
  if (!pool) {
    const data = await readData();
    const index = data.requests.findIndex((entry) => entry.id === record.id);
    if (index === -1) {
      return false;
    }

    data.requests[index] = record;
    await writeData(data);
    return true;
  }

  await initializeDatabase();
  const result = await pool.query(
    `UPDATE requests
    SET child_name = $2,
        name = $3,
        meal_type = $4,
        reply_source = $5,
        created_at = $6,
        updated_at = $7,
        reply = $8,
        snotty_remark = $9,
        repeated_from_yesterday = $10,
        status = $11,
        archived_at = $12
    WHERE id = $1`,
    [
      record.id,
      record.childName,
      record.name,
      record.mealType,
      record.replySource,
      record.createdAt,
      record.updatedAt,
      record.reply,
      record.snottyRemark,
      record.repeatedFromYesterday,
      record.status,
      record.archivedAt,
    ]
  );

  return result.rowCount > 0;
}

async function readData() {
  await ensureDataFile();

  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
    };
  } catch {
    return structuredClone(DATA_TEMPLATE);
  }
}

async function writeData(data) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function sanitizeRequest(record) {
  return {
    id: String(record.id || ""),
    childName: String(record.childName || "").trim().slice(0, 40),
    name: String(record.name || "").trim().slice(0, 60),
    mealType: record.mealType === "dinner" ? "dinner" : "lunch",
    replySource: record.replySource === "openai" ? "openai" : "fallback",
    createdAt: Number(record.createdAt || Date.now()),
    updatedAt: record.updatedAt ? Number(record.updatedAt) : null,
    reply: String(record.reply || "").trim().slice(0, 240),
    snottyRemark: String(record.snottyRemark || "").trim().slice(0, 240),
    repeatedFromYesterday: Boolean(record.repeatedFromYesterday),
    status: record.status === "archived" ? "archived" : "active",
    archivedAt: record.archivedAt ? Number(record.archivedAt) : null,
  };
}

function normalizeFoodName(food) {
  return String(food || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getLocalDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getYesterdayDateKey(now = Date.now()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  return getLocalDateKey(date.getTime());
}

function isEditableToday(request, childName, now = Date.now()) {
  return (
    request.status !== "archived" &&
    normalizeFoodName(request.childName) === normalizeFoodName(childName) &&
    getLocalDateKey(request.createdAt) === getLocalDateKey(now)
  );
}

function requestedSameFoodYesterday(requests, childName, food, now = Date.now(), excludedRequestId = "") {
  const yesterdayKey = getYesterdayDateKey(now);
  const normalizedFood = normalizeFoodName(food);
  const normalizedChildName = normalizeFoodName(childName);

  return requests.some((request) => {
    if (request.id === excludedRequestId) {
      return false;
    }

    return (
      normalizeFoodName(request.childName) === normalizedChildName &&
      normalizeFoodName(request.name) === normalizedFood &&
      getLocalDateKey(request.createdAt) === yesterdayKey
    );
  });
}

function summarizeRequests(requests) {
  const sorted = requests
    .map(sanitizeRequest)
    .filter((request) => request.id && request.name)
    .sort((left, right) => right.createdAt - left.createdAt);

  const activeRequests = sorted.filter((request) => request.status === "active");
  const archivedRequests = sorted.filter((request) => request.status === "archived");
  const childCounts = new Map();
  const foodCounts = new Map();
  const dayCounts = new Map();

  sorted.forEach((request) => {
    childCounts.set(request.childName, (childCounts.get(request.childName) || 0) + 1);
    foodCounts.set(request.name, (foodCounts.get(request.name) || 0) + 1);

    const dayKey = new Date(request.createdAt).toISOString().slice(0, 10);
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
  });

  return {
    totals: {
      total: sorted.length,
      active: activeRequests.length,
      archived: archivedRequests.length,
    },
    activeRequests,
    requests: sorted,
    topFoods: Array.from(foodCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      .slice(0, 8),
    requestsByChild: Array.from(childCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    requestsByDay: Array.from(dayCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  };
}

async function listRequests() {
  const requests = await loadRequestRecords();
  return summarizeRequests(requests);
}

async function createSnottyRemark(food) {
  if (!OPENAI_API_KEY) {
    return FALLBACK_SNOTTY_REMARKS[Math.floor(Math.random() * FALLBACK_SNOTTY_REMARKS.length)];
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
                "You write one short, snotty but family-safe remark for a child who requested the same food as yesterday. Keep it playful, not mean, and do not use profanity.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Write exactly one sentence about repeating ${food} again today after asking for it yesterday.`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const payload = await response.json();
  const remark = String(payload.output_text || "").trim();
  return remark || FALLBACK_SNOTTY_REMARKS[Math.floor(Math.random() * FALLBACK_SNOTTY_REMARKS.length)];
}

async function buildRequestResponse(requests, { childName, food, excludedRequestId = "" }) {
  let reply;
  let replySource = "openai";

  try {
    reply = await createCheekyReply(food);
  } catch (error) {
    console.error("OpenAI reply generation failed:", error);
    const fallback = fallbackReply(food);
    reply = rememberAndReturn(fallback.text, fallback.key);
    replySource = "fallback";
  }

  const repeatedFromYesterday = requestedSameFoodYesterday(requests, childName, food, Date.now(), excludedRequestId);

  if (!repeatedFromYesterday) {
    return {
      reply,
      replySource,
      repeatedFromYesterday: false,
      snottyRemark: "",
    };
  }

  try {
    const snottyRemark = await createSnottyRemark(food);
    return {
      reply,
      replySource,
      repeatedFromYesterday: true,
      snottyRemark,
    };
  } catch {
    return {
      reply,
      replySource,
      repeatedFromYesterday: true,
      snottyRemark: FALLBACK_SNOTTY_REMARKS[Math.floor(Math.random() * FALLBACK_SNOTTY_REMARKS.length)],
    };
  }
}

async function createRequestRecord({ childName, food, mealType }) {
  const name = String(food || "").trim().slice(0, 60);
  const trimmedChildName = String(childName || "").trim().slice(0, 40);
  const normalizedMealType = mealType === "dinner" ? "dinner" : "lunch";

  if (!name || !trimmedChildName) {
    return null;
  }

  const requestRecord = {
    id: crypto.randomUUID(),
    childName: trimmedChildName,
    name,
    mealType: normalizedMealType,
    createdAt: Date.now(),
    updatedAt: null,
    reply: "",
    replySource: "fallback",
    snottyRemark: "",
    repeatedFromYesterday: false,
    status: "active",
    archivedAt: null,
  };

  const requests = await loadRequestRecords();
  const requestResponse = await buildRequestResponse(requests, {
    childName: trimmedChildName,
    food: name,
  });

  requestRecord.reply = requestResponse.reply;
  requestRecord.replySource = requestResponse.replySource;
  requestRecord.snottyRemark = requestResponse.snottyRemark;
  requestRecord.repeatedFromYesterday = requestResponse.repeatedFromYesterday;
  await insertRequestRecord(requestRecord);

  return sanitizeRequest(requestRecord);
}

async function updateRequestRecord(requestId, { childName, food, mealType }) {
  const name = String(food || "").trim().slice(0, 60);
  const trimmedChildName = String(childName || "").trim().slice(0, 40);
  const normalizedMealType = mealType === "dinner" ? "dinner" : "lunch";

  if (!name || !trimmedChildName) {
    return { error: "Child name and food are required.", statusCode: 400 };
  }

  const requests = await loadRequestRecords();
  const request = requests.find((entry) => entry.id === requestId);

  if (!request) {
    return { error: "Request not found.", statusCode: 404 };
  }

  if (!isEditableToday(request, trimmedChildName)) {
    return { error: "Only today's active requests for this child can be edited.", statusCode: 403 };
  }

  const requestResponse = await buildRequestResponse(requests, {
    childName: trimmedChildName,
    food: name,
    excludedRequestId: requestId,
  });

  request.name = name;
  request.mealType = normalizedMealType;
  request.updatedAt = Date.now();
  request.reply = requestResponse.reply;
  request.replySource = requestResponse.replySource;
  request.snottyRemark = requestResponse.snottyRemark;
  request.repeatedFromYesterday = requestResponse.repeatedFromYesterday;
  await saveUpdatedRequestRecord(request);

  return { request: sanitizeRequest(request), statusCode: 200 };
}

async function archiveRequestById(requestId) {
  const requests = await loadRequestRecords();
  const request = requests.find((entry) => entry.id === requestId && entry.status !== "archived");

  if (!request) {
    return false;
  }

  request.status = "archived";
  request.archivedAt = Date.now();
  return saveUpdatedRequestRecord(request);
}

async function archiveAllActiveRequests() {
  const requests = await loadRequestRecords();
  let changed = false;

  for (const request of requests) {
    if (request.status !== "archived") {
      request.status = "archived";
      request.archivedAt = Date.now();
      request.updatedAt = Date.now();
      await saveUpdatedRequestRecord(request);
      changed = true;
    }
  }

  return changed;
}

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
    const pathname = url.pathname;

    if (request.method === "POST" && pathname === "/api/cheeky-response") {
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

    if (request.method === "GET" && pathname === "/api/requests") {
      const summary = await listRequests();
      sendJson(response, 200, { requests: summary.activeRequests });
      return;
    }

    if (request.method === "GET" && pathname === "/api/analytics/requests") {
      const summary = await listRequests();
      sendJson(response, 200, summary);
      return;
    }

    if (request.method === "POST" && pathname === "/api/requests") {
      const body = await readRequestBody(request);
      const parsed = JSON.parse(body || "{}");
      const requestRecord = await createRequestRecord({
        childName: parsed.childName,
        food: parsed.food,
        mealType: parsed.mealType,
      });

      if (!requestRecord) {
        sendJson(response, 400, { error: "Child name and food are required." });
        return;
      }

      sendJson(response, 201, { request: requestRecord });
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/requests/")) {
      const [, , , requestId, action] = pathname.split("/");

      if (action === "update" && requestId) {
        const body = await readRequestBody(request);
        const parsed = JSON.parse(body || "{}");
        const result = await updateRequestRecord(requestId, {
          childName: parsed.childName,
          food: parsed.food,
          mealType: parsed.mealType,
        });

        if (result.error) {
          sendJson(response, result.statusCode || 400, { error: result.error });
          return;
        }

        sendJson(response, 200, { request: result.request });
        return;
      }
    }

    if (request.method === "POST" && pathname === "/api/requests/archive-all") {
      await archiveAllActiveRequests();
      const summary = await listRequests();
      sendJson(response, 200, { requests: summary.activeRequests });
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/requests/")) {
      const [, , , requestId, action] = pathname.split("/");

      if (action === "archive" && requestId) {
        const archived = await archiveRequestById(requestId);

        if (!archived) {
          sendJson(response, 404, { error: "Request not found." });
          return;
        }

        const summary = await listRequests();
        sendJson(response, 200, { requests: summary.activeRequests });
        return;
      }
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

async function startServer() {
  try {
    await initializeDatabase();
    server.listen(PORT, HOST, () => {
      console.log(
        `OpenAI configured: ${OPENAI_API_KEY ? "yes" : "no"}; model: ${OPENAI_MODEL}; persistence: ${
          pool ? "postgres" : "local-json"
        }`
      );
      console.log(`FeedMe Today running at http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize persistence layer:", error);
    process.exit(1);
  }
}

startServer();
