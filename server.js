const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const OPENAI_COOLDOWN_MS = Number(process.env.OPENAI_COOLDOWN_MS || 5 * 60 * 1000);
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Jerusalem";
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_FILE = path.join(__dirname, "data", "requests.json");
const DATA_TEMPLATE = {
  requests: [],
  fallbackResponses: [],
  dailyCheckIns: [],
};
const PROFILES = {
  kids: ["Ofer", "Amit", "Nitzan"],
  parent: ["Roni", "Adi"],
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
const FALLBACK_RESPONSE_LIMIT = 200;
const STYLE_HINTS = [
  "Say it like a dramatic TV chef.",
  "Say it like a playful soccer commentator.",
  "Say it like a royal announcement from the kitchen.",
  "Say it like a slightly offended restaurant critic.",
  "Say it like a superhero chef with too much confidence.",
  "Say it like a pirate who runs a lunchroom.",
  "Say it like a game show host revealing a surprise prize.",
  "Say it like a sleepy parent trying to stay funny.",
  "Say it like breaking news from a very chaotic kitchen.",
  "Say it like a fantasy wizard reacting to a sacred menu quest.",
  "Say it like a courtroom lawyer making a dramatic closing argument.",
  "Say it like a nature documentary about a rare lunch decision.",
  "Say it like mission control handling a snack emergency.",
  "Say it like an old-time radio announcer with huge feelings.",
  "Say it like a museum curator unveiling a suspicious masterpiece.",
  "Say it like a sports draft pick for the Hall of Lunch.",
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
const RIDE_REPLY_TEMPLATES = [
  "Ride request noted: {purpose} from {from} to {to} at {time}. The chauffeur calendar just raised an eyebrow.",
  "Pickup mission accepted for {time}: {from} to {to} for {purpose}. The family taxi will review the route.",
  "Request received for a {time} ride from {from} to {to} for {purpose}. The back seat is considering terms.",
  "Transportation alert: {purpose}, {from} to {to}, leaving at {time}. The ride desk has it on the board.",
  "Your ride request for {purpose} at {time} from {from} to {to} is in. The driver may request snacks as payment.",
];
const LUNCH_BREAK_UNKNOWN_CONTEXT_KEY = "system:lunch-break-unknown";
const LUNCH_BREAK_UNKNOWN_POOL_TARGET = 20;
const LUNCH_BREAK_UNKNOWN_FALLBACKS = [
  "Go check it out and report back like a proper lunch detective.",
  "March to the schedule board and return with facts, not vibes.",
  "The lunch hour did not vanish. Go find it.",
  "Off you go, tiny investigator. Lunch time will not discover itself.",
];
const recentReplies = [];
let databaseInitializationPromise = null;
let openAICooldownUntil = 0;

function normalizeRequestType(requestType) {
  return requestType === "ride" ? "ride" : "food";
}

function normalizeMealType(mealType, requestType = "food") {
  if (normalizeRequestType(requestType) === "ride") {
    return "ride";
  }

  return mealType === "dinner" ? "dinner" : "lunch";
}

function cleanRideField(value, maxLength = 80) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function extractOpenAIErrorMessage(errorText) {
  const trimmed = String(errorText || "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);
    const message = parsed && parsed.error && typeof parsed.error.message === "string" ? parsed.error.message : "";
    return message.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function requestOpenAIResponse(input) {
  if (!OPENAI_API_KEY) {
    return null;
  }

  if (openAICooldownUntil > Date.now()) {
    throw new Error("OpenAI temporarily disabled after a recent 429.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input,
    }),
  });

  if (!response.ok) {
    const errorText = extractOpenAIErrorMessage(await response.text());

    if (response.status === 429) {
      openAICooldownUntil = Date.now() + OPENAI_COOLDOWN_MS;
    }

    throw new Error(`OpenAI request failed: ${response.status}${errorText ? ` ${errorText}` : ""}`);
  }

  openAICooldownUntil = 0;
  return response.json();
}

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
    databaseInitializationPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS requests (
          id TEXT PRIMARY KEY,
          child_name TEXT NOT NULL,
          name TEXT NOT NULL,
          meal_type TEXT NOT NULL,
          request_type TEXT NOT NULL DEFAULT 'food',
          ride_time TEXT NOT NULL DEFAULT '',
          ride_from TEXT NOT NULL DEFAULT '',
          ride_to TEXT NOT NULL DEFAULT '',
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

      await pool.query(`
        CREATE TABLE IF NOT EXISTS fallback_responses (
          id TEXT PRIMARY KEY,
          request_type TEXT NOT NULL,
          context_key TEXT NOT NULL,
          reply TEXT NOT NULL,
          template TEXT NOT NULL DEFAULT '',
          created_at BIGINT NOT NULL
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_checkins (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          date_key TEXT NOT NULL,
          role_name TEXT NOT NULL,
          person_name TEXT NOT NULL,
          lunch_break_time TEXT NOT NULL DEFAULT '',
          created_at BIGINT NOT NULL,
          updated_at BIGINT,
          UNIQUE (device_id, date_key)
        )
      `);

      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'food'`);
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ride_time TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ride_from TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ride_to TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE fallback_responses ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE daily_checkins ADD COLUMN IF NOT EXISTS lunch_break_time TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE daily_checkins ADD COLUMN IF NOT EXISTS updated_at BIGINT`);
    })();
  }

  await databaseInitializationPromise;
}

function mapRowToRequest(row) {
  return {
    id: row.id,
    childName: row.child_name,
    name: row.name,
    requestType: row.request_type,
    mealType: row.meal_type,
    rideTime: row.ride_time,
    rideFrom: row.ride_from,
    rideTo: row.ride_to,
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

function mapRowToDailyCheckIn(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    dateKey: row.date_key,
    role: row.role_name,
    name: row.person_name,
    lunchBreakTime: row.lunch_break_time,
    createdAt: Number(row.created_at),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
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
      request_type,
      ride_time,
      ride_from,
      ride_to,
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
      request_type,
      ride_time,
      ride_from,
      ride_to,
      reply_source,
      created_at,
      updated_at,
      reply,
      snotty_remark,
      repeated_from_yesterday,
      status,
      archived_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      record.id,
      record.childName,
      record.name,
      record.mealType,
      record.requestType,
      record.rideTime,
      record.rideFrom,
      record.rideTo,
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
        request_type = $5,
        ride_time = $6,
        ride_from = $7,
        ride_to = $8,
        reply_source = $9,
        created_at = $10,
        updated_at = $11,
        reply = $12,
        snotty_remark = $13,
        repeated_from_yesterday = $14,
        status = $15,
        archived_at = $16
    WHERE id = $1`,
    [
      record.id,
      record.childName,
      record.name,
      record.mealType,
      record.requestType,
      record.rideTime,
      record.rideFrom,
      record.rideTo,
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

async function loadDailyCheckInRecords() {
  if (!pool) {
    const data = await readData();
    return data.dailyCheckIns.map(sanitizeDailyCheckIn);
  }

  await initializeDatabase();
  const result = await pool.query(
    `SELECT
      id,
      device_id,
      date_key,
      role_name,
      person_name,
      lunch_break_time,
      created_at,
      updated_at
    FROM daily_checkins`
  );

  return result.rows.map(mapRowToDailyCheckIn).map(sanitizeDailyCheckIn);
}

async function insertDailyCheckInRecord(record) {
  if (!pool) {
    const data = await readData();
    data.dailyCheckIns.push(record);
    await writeData(data);
    return;
  }

  await initializeDatabase();
  await pool.query(
    `INSERT INTO daily_checkins (
      id,
      device_id,
      date_key,
      role_name,
      person_name,
      lunch_break_time,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.deviceId,
      record.dateKey,
      record.role,
      record.name,
      record.lunchBreakTime,
      record.createdAt,
      record.updatedAt,
    ]
  );
}

async function saveUpdatedDailyCheckInRecord(record) {
  if (!pool) {
    const data = await readData();
    const index = data.dailyCheckIns.findIndex((entry) => entry.id === record.id);
    if (index === -1) {
      return false;
    }

    data.dailyCheckIns[index] = record;
    await writeData(data);
    return true;
  }

  await initializeDatabase();
  const result = await pool.query(
    `UPDATE daily_checkins
    SET device_id = $2,
        date_key = $3,
        role_name = $4,
        person_name = $5,
        lunch_break_time = $6,
        created_at = $7,
        updated_at = $8
    WHERE id = $1`,
    [
      record.id,
      record.deviceId,
      record.dateKey,
      record.role,
      record.name,
      record.lunchBreakTime,
      record.createdAt,
      record.updatedAt,
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
      fallbackResponses: Array.isArray(parsed.fallbackResponses) ? parsed.fallbackResponses : [],
      dailyCheckIns: Array.isArray(parsed.dailyCheckIns) ? parsed.dailyCheckIns : [],
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
  const requestType = normalizeRequestType(record.requestType);

  return {
    id: String(record.id || ""),
    childName: String(record.childName || "").trim().slice(0, 40),
    name: String(record.name || "").trim().slice(0, 60),
    requestType,
    mealType: normalizeMealType(record.mealType, requestType),
    rideTime: requestType === "ride" ? cleanRideField(record.rideTime, 20) : "",
    rideFrom: requestType === "ride" ? cleanRideField(record.rideFrom, 80) : "",
    rideTo: requestType === "ride" ? cleanRideField(record.rideTo, 80) : "",
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

function sanitizeDailyCheckIn(record) {
  const role = record.role === "kids" ? "kids" : "parent";
  const validNames = PROFILES[role] || [];
  const fallbackName = validNames[0] || "";
  const normalizedName = validNames.includes(record.name) ? record.name : fallbackName;

  return {
    id: String(record.id || crypto.randomUUID()),
    deviceId: String(record.deviceId || "").trim().slice(0, 120),
    dateKey: String(record.dateKey || getLocalDateKey(Date.now())).trim().slice(0, 10),
    role,
    name: normalizedName,
    lunchBreakTime:
      role === "kids" ? String(record.lunchBreakTime || "").trim().slice(0, 5) : "",
    createdAt: Number(record.createdAt || Date.now()),
    updatedAt: record.updatedAt == null ? null : Number(record.updatedAt),
  };
}

function normalizeFoodName(food) {
  return String(food || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeFallbackResponse(entry) {
  const requestType = normalizeRequestType(entry.requestType);
  const reply = String(entry.reply || "").trim().slice(0, 240);
  const template = String(entry.template || "").trim().slice(0, 240);

  return {
    id: String(entry.id || ""),
    requestType,
    contextKey: String(entry.contextKey || "").trim().slice(0, 240),
    reply,
    template,
    createdAt: Number(entry.createdAt || Date.now()),
  };
}

function buildFoodContextKey(food) {
  return `food:${normalizeFoodName(food)}`;
}

function buildRideContextKey({ time, from, to, purpose }) {
  return `ride:${normalizeFoodName(time)}|${normalizeFoodName(from)}|${normalizeFoodName(to)}|${normalizeFoodName(
    purpose
  )}`;
}

function createFoodFallbackTemplate(reply, food) {
  const trimmedReply = String(reply || "").trim();
  const trimmedFood = String(food || "").trim();
  if (!trimmedReply || !trimmedFood) {
    return "";
  }

  const pattern = new RegExp(escapeRegExp(trimmedFood), "gi");
  if (!pattern.test(trimmedReply)) {
    return "";
  }

  return trimmedReply.replace(pattern, "{food}");
}

function createRideFallbackTemplate(reply, { time, from, to, purpose }) {
  let template = String(reply || "").trim();
  const replacements = [
    ["{time}", time],
    ["{from}", from],
    ["{to}", to],
    ["{purpose}", purpose],
  ];

  for (const [placeholder, value] of replacements) {
    const trimmedValue = String(value || "").trim();
    if (!trimmedValue) {
      return "";
    }

    const pattern = new RegExp(escapeRegExp(trimmedValue), "gi");
    if (!pattern.test(template)) {
      return "";
    }

    template = template.replace(pattern, placeholder);
  }

  return template;
}

function renderFallbackTemplate(template, replacements) {
  let rendered = String(template || "").trim();
  if (!rendered) {
    return "";
  }

  for (const [placeholder, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(placeholder, value);
  }

  return rendered;
}

async function loadFallbackResponses(requestType) {
  if (!pool) {
    const data = await readData();
    return data.fallbackResponses
      .map(normalizeFallbackResponse)
      .filter((entry) => entry.requestType === normalizeRequestType(requestType) && entry.reply);
  }

  await initializeDatabase();
  const result = await pool.query(
    `SELECT id, request_type, context_key, reply, template, created_at
    FROM fallback_responses
    WHERE request_type = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [normalizeRequestType(requestType), FALLBACK_RESPONSE_LIMIT]
  );

  return result.rows.map((row) =>
    normalizeFallbackResponse({
      id: row.id,
      requestType: row.request_type,
      contextKey: row.context_key,
      reply: row.reply,
      template: row.template,
      createdAt: row.created_at,
    })
  );
}

async function loadFallbackResponsesByContext(contextKey) {
  const normalizedContextKey = String(contextKey || "").trim().slice(0, 240);
  if (!normalizedContextKey) {
    return [];
  }

  if (!pool) {
    const data = await readData();
    return data.fallbackResponses
      .map(normalizeFallbackResponse)
      .filter((entry) => entry.contextKey === normalizedContextKey && entry.reply);
  }

  await initializeDatabase();
  const result = await pool.query(
    `SELECT id, request_type, context_key, reply, template, created_at
    FROM fallback_responses
    WHERE context_key = $1
    ORDER BY created_at ASC`,
    [normalizedContextKey]
  );

  return result.rows.map((row) =>
    normalizeFallbackResponse({
      id: row.id,
      requestType: row.request_type,
      contextKey: row.context_key,
      reply: row.reply,
      template: row.template,
      createdAt: row.created_at,
    })
  );
}

async function storeFallbackResponse(entry) {
  const record = normalizeFallbackResponse({
    id: entry.id || crypto.randomUUID(),
    requestType: entry.requestType,
    contextKey: entry.contextKey,
    reply: entry.reply,
    template: entry.template,
    createdAt: entry.createdAt,
  });

  if (!record.contextKey || !record.reply) {
    return;
  }

  if (!pool) {
    const data = await readData();
    const alreadyExists = data.fallbackResponses.some((existing) => {
      const normalized = normalizeFallbackResponse(existing);
      return normalized.requestType === record.requestType && normalized.reply === record.reply;
    });

    if (alreadyExists) {
      return;
    }

    data.fallbackResponses.push(record);
    if (data.fallbackResponses.length > FALLBACK_RESPONSE_LIMIT) {
      data.fallbackResponses = data.fallbackResponses.slice(-FALLBACK_RESPONSE_LIMIT);
    }
    await writeData(data);
    return;
  }

  await initializeDatabase();
  const existing = await pool.query(
    `SELECT id
    FROM fallback_responses
    WHERE request_type = $1 AND reply = $2
    LIMIT 1`,
    [record.requestType, record.reply]
  );

  if (existing.rowCount) {
    return;
  }

  await pool.query(
    `INSERT INTO fallback_responses (id, request_type, context_key, reply, template, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [record.id, record.requestType, record.contextKey, record.reply, record.template, record.createdAt]
  );
}

function getLocalDateKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
}

function getYesterdayDateKey(now = Date.now()) {
  const [year, month, day] = getLocalDateKey(now).split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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
    .filter((request) => request.id && request.childName && request.name)
    .sort((left, right) => right.createdAt - left.createdAt);

  const activeRequests = sorted.filter((request) => request.status === "active");
  const archivedRequests = sorted.filter((request) => request.status === "archived");
  const childCounts = new Map();
  const foodCounts = new Map();
  const dayCounts = new Map();

  sorted.forEach((request) => {
    childCounts.set(request.childName, (childCounts.get(request.childName) || 0) + 1);
    if (request.requestType === "food") {
      foodCounts.set(request.name, (foodCounts.get(request.name) || 0) + 1);
    }

    const dayKey = getLocalDateKey(request.createdAt);
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

async function listTodayDailyCheckIns() {
  const dateKey = getLocalDateKey(Date.now());
  const records = await loadDailyCheckInRecords();
  return records
    .filter((record) => record.dateKey === dateKey && record.deviceId)
    .sort((left, right) => right.createdAt - left.createdAt);
}

async function findTodayDailyCheckInByDevice(deviceId) {
  const normalizedDeviceId = String(deviceId || "").trim().slice(0, 120);
  if (!normalizedDeviceId) {
    return null;
  }

  const todayCheckIns = await listTodayDailyCheckIns();
  return todayCheckIns.find((record) => record.deviceId === normalizedDeviceId) || null;
}

async function saveTodayDailyCheckIn({ deviceId, role, name, lunchBreakTime }) {
  const normalizedDeviceId = String(deviceId || "").trim().slice(0, 120);
  const normalizedRole = role === "kids" ? "kids" : role === "parent" ? "parent" : "";
  const normalizedName = String(name || "").trim();
  const normalizedLunchBreakTime = String(lunchBreakTime || "").trim().slice(0, 5);

  if (!normalizedDeviceId || !normalizedRole || !PROFILES[normalizedRole]?.includes(normalizedName)) {
    return null;
  }

  if (normalizedRole === "kids" && !normalizedLunchBreakTime) {
    return null;
  }

  const dateKey = getLocalDateKey(Date.now());
  const existing = await findTodayDailyCheckInByDevice(normalizedDeviceId);

  if (existing) {
    const updated = sanitizeDailyCheckIn({
      ...existing,
      role: normalizedRole,
      name: normalizedName,
      lunchBreakTime: normalizedRole === "kids" ? normalizedLunchBreakTime : "",
      updatedAt: Date.now(),
    });
    await saveUpdatedDailyCheckInRecord(updated);
    return updated;
  }

  const record = sanitizeDailyCheckIn({
    id: crypto.randomUUID(),
    deviceId: normalizedDeviceId,
    dateKey,
    role: normalizedRole,
    name: normalizedName,
    lunchBreakTime: normalizedRole === "kids" ? normalizedLunchBreakTime : "",
    createdAt: Date.now(),
    updatedAt: null,
  });
  await insertDailyCheckInRecord(record);
  return record;
}

async function generateLunchBreakUnknownPool() {
  if (!OPENAI_API_KEY) {
    return [];
  }

  const payload = await requestOpenAIResponse([
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You write funny, family-safe one-sentence lines telling a kid to go check when lunch break is instead of saying they do not know. Keep them playful, brisk, and mildly teasing, never cruel. No profanity. No emojis. Every line should be distinct.",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            "Return exactly 20 lines as a JSON array of strings. Each string should be 8 to 18 words. The message should tell the kid to go check when lunch is instead of being lazy. Vary the joke style and wording a lot.",
        },
      ],
    },
  ]);

  let parsed;
  try {
    parsed = JSON.parse(String(payload.output_text || "[]"));
  } catch {
    parsed = [];
  }

  return Array.isArray(parsed)
    ? parsed
        .map((entry) => String(entry || "").trim().replace(/\s+/g, " ").slice(0, 240))
        .filter(Boolean)
    : [];
}

async function ensureLunchBreakUnknownPool() {
  const existing = await loadFallbackResponsesByContext(LUNCH_BREAK_UNKNOWN_CONTEXT_KEY);
  if (existing.length >= LUNCH_BREAK_UNKNOWN_POOL_TARGET) {
    return existing;
  }

  let generated = [];
  try {
    generated = await generateLunchBreakUnknownPool();
  } catch (error) {
    console.error("OpenAI lunch-break nudge generation failed:", error);
  }

  const uniqueReplies = Array.from(new Set([...existing.map((entry) => entry.reply), ...generated])).slice(
    0,
    LUNCH_BREAK_UNKNOWN_POOL_TARGET
  );

  for (const reply of uniqueReplies) {
    await storeFallbackResponse({
      requestType: "food",
      contextKey: LUNCH_BREAK_UNKNOWN_CONTEXT_KEY,
      reply,
      template: "",
      createdAt: Date.now(),
    });
  }

  const stored = await loadFallbackResponsesByContext(LUNCH_BREAK_UNKNOWN_CONTEXT_KEY);
  if (stored.length) {
    return stored;
  }

  return LUNCH_BREAK_UNKNOWN_FALLBACKS.map((reply, index) =>
    normalizeFallbackResponse({
      id: `lunch-break-unknown-fallback-${index}`,
      requestType: "food",
      contextKey: LUNCH_BREAK_UNKNOWN_CONTEXT_KEY,
      reply,
      template: "",
      createdAt: Date.now() + index,
    })
  );
}

async function getLunchBreakUnknownResponse() {
  const stored = await loadFallbackResponsesByContext(LUNCH_BREAK_UNKNOWN_CONTEXT_KEY);
  const pool = stored.length ? stored : LUNCH_BREAK_UNKNOWN_FALLBACKS.map((reply) => ({ reply }));
  const choice = pool[Math.floor(Math.random() * pool.length)];
  return String(choice.reply || "").trim() || LUNCH_BREAK_UNKNOWN_FALLBACKS[0];
}

async function createSnottyRemark(food) {
  if (!OPENAI_API_KEY) {
    return FALLBACK_SNOTTY_REMARKS[Math.floor(Math.random() * FALLBACK_SNOTTY_REMARKS.length)];
  }

  const payload = await requestOpenAIResponse([
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
  ]);
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
    const fallback = await fallbackReply(food);
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

async function buildRideRequestResponse({ time, from, to, purpose }) {
  let reply;
  let replySource = "openai";

  try {
    reply = await createRideReply({ time, from, to, purpose });
  } catch (error) {
    console.error("OpenAI ride reply generation failed:", error);
    const fallback = await getRideFallbackReply({ time, from, to, purpose });
    reply = rememberAndReturn(fallback.text, fallback.key);
    replySource = "fallback";
  }

  return {
    reply,
    replySource,
    repeatedFromYesterday: false,
    snottyRemark: "",
  };
}

async function createRequestRecord({ childName, food, mealType, requestType, rideTime, rideFrom, rideTo, purpose }) {
  const normalizedRequestType = normalizeRequestType(requestType);
  const trimmedChildName = String(childName || "").trim().slice(0, 40);
  const normalizedMealType = normalizeMealType(mealType, normalizedRequestType);
  const name =
    normalizedRequestType === "ride"
      ? cleanRideField(purpose, 60)
      : String(food || "").trim().slice(0, 60);
  const normalizedRideTime = normalizedRequestType === "ride" ? cleanRideField(rideTime, 20) : "";
  const normalizedRideFrom = normalizedRequestType === "ride" ? cleanRideField(rideFrom, 80) : "";
  const normalizedRideTo = normalizedRequestType === "ride" ? cleanRideField(rideTo, 80) : "";

  if (
    !trimmedChildName ||
    !name ||
    (normalizedRequestType === "ride" && (!normalizedRideTime || !normalizedRideFrom || !normalizedRideTo))
  ) {
    return null;
  }

  const requestRecord = {
    id: crypto.randomUUID(),
    childName: trimmedChildName,
    name,
    requestType: normalizedRequestType,
    mealType: normalizedMealType,
    rideTime: normalizedRideTime,
    rideFrom: normalizedRideFrom,
    rideTo: normalizedRideTo,
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
  const requestResponse =
    normalizedRequestType === "ride"
      ? await buildRideRequestResponse({
          time: normalizedRideTime,
          from: normalizedRideFrom,
          to: normalizedRideTo,
          purpose: name,
        })
      : await buildRequestResponse(requests, {
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

async function updateRequestRecord(
  requestId,
  { childName, food, mealType, requestType, rideTime, rideFrom, rideTo, purpose }
) {
  const normalizedRequestType = normalizeRequestType(requestType);
  const trimmedChildName = String(childName || "").trim().slice(0, 40);
  const normalizedMealType = normalizeMealType(mealType, normalizedRequestType);
  const name =
    normalizedRequestType === "ride"
      ? cleanRideField(purpose, 60)
      : String(food || "").trim().slice(0, 60);
  const normalizedRideTime = normalizedRequestType === "ride" ? cleanRideField(rideTime, 20) : "";
  const normalizedRideFrom = normalizedRequestType === "ride" ? cleanRideField(rideFrom, 80) : "";
  const normalizedRideTo = normalizedRequestType === "ride" ? cleanRideField(rideTo, 80) : "";

  if (
    !trimmedChildName ||
    !name ||
    (normalizedRequestType === "ride" && (!normalizedRideTime || !normalizedRideFrom || !normalizedRideTo))
  ) {
    return {
      error:
        normalizedRequestType === "ride"
          ? "Child name, time, from, to, and purpose are required."
          : "Child name and food are required.",
      statusCode: 400,
    };
  }

  const requests = await loadRequestRecords();
  const request = requests.find((entry) => entry.id === requestId);

  if (!request) {
    return { error: "Request not found.", statusCode: 404 };
  }

  if (!isEditableToday(request, trimmedChildName)) {
    return { error: "Only today's active requests for this child can be edited.", statusCode: 403 };
  }

  const requestResponse =
    normalizedRequestType === "ride"
      ? await buildRideRequestResponse({
          time: normalizedRideTime,
          from: normalizedRideFrom,
          to: normalizedRideTo,
          purpose: name,
        })
      : await buildRequestResponse(requests, {
          childName: trimmedChildName,
          food: name,
          excludedRequestId: requestId,
        });

  request.name = name;
  request.requestType = normalizedRequestType;
  request.mealType = normalizedMealType;
  request.rideTime = normalizedRideTime;
  request.rideFrom = normalizedRideFrom;
  request.rideTo = normalizedRideTo;
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

async function fallbackReply(food) {
  const storedResponses = await loadFallbackResponses("food");
  const contextKey = buildFoodContextKey(food);
  const storedCandidates = storedResponses
    .filter((entry) => entry.contextKey === contextKey || entry.template.includes("{food}"))
    .map((entry, index) => {
      const rendered = entry.template.includes("{food}")
        ? renderFallbackTemplate(entry.template, { "{food}": food })
        : entry.reply;

      return {
        key: entry.id || `stored-food:${index}`,
        text: rendered,
      };
    })
    .filter((entry) => entry.text);

  const allCandidates = fallbackCandidates(food);
  const candidatePool = [...storedCandidates, ...allCandidates];
  const freshCandidates = candidatePool.filter((candidate) => !hasRecentReply(candidate.key));
  const pool = freshCandidates.length ? freshCandidates : candidatePool;
  return pool[Math.floor(Math.random() * pool.length)];
}

function createRideFallbackReply({ time, from, to, purpose }) {
  const template = RIDE_REPLY_TEMPLATES[Math.floor(Math.random() * RIDE_REPLY_TEMPLATES.length)];
  const text = template
    .replaceAll("{time}", time)
    .replaceAll("{from}", from)
    .replaceAll("{to}", to)
    .replaceAll("{purpose}", purpose);

  return {
    key: `ride:${time}:${from}:${to}:${purpose}`,
    text,
  };
}

async function getRideFallbackReply({ time, from, to, purpose }) {
  const storedResponses = await loadFallbackResponses("ride");
  const contextKey = buildRideContextKey({ time, from, to, purpose });
  const storedCandidates = storedResponses
    .filter(
      (entry) =>
        entry.contextKey === contextKey ||
        ["{time}", "{from}", "{to}", "{purpose}"].every((placeholder) => entry.template.includes(placeholder))
    )
    .map((entry, index) => {
      const rendered = entry.template
        ? renderFallbackTemplate(entry.template, {
            "{time}": time,
            "{from}": from,
            "{to}": to,
            "{purpose}": purpose,
          })
        : entry.reply;

      return {
        key: entry.id || `stored-ride:${index}`,
        text: rendered,
      };
    })
    .filter((entry) => entry.text);

  const builtInFallback = createRideFallbackReply({ time, from, to, purpose });
  const candidatePool = [...storedCandidates, builtInFallback];
  const freshCandidates = candidatePool.filter((candidate) => !hasRecentReply(candidate.key));
  const pool = freshCandidates.length ? freshCandidates : candidatePool;
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
    const fallback = await fallbackReply(food);
    return rememberAndReturn(fallback.text, fallback.key);
  }

  const recentReplyList = recentReplies.length
    ? recentReplies.map((reply) => `- ${reply.text}`).join("\n")
    : "None";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const styleHint = randomStyleHint();

    const payload = await requestOpenAIResponse([
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a brilliantly funny family-safe chef comedian. Reply with exactly one short sentence about the child's requested food. Every answer must feel specific, surprising, and freshly improvised, not like a canned joke. Mention the food by name. Vary the comic structure from reply to reply: sometimes use mock drama, absurd comparison, fake seriousness, overconfident hype, tiny plot twist, or a weird image. Avoid generic lines, recycled praise, repeated sentence rhythms, and obvious filler like 'bold choice' or 'interesting choice'. Keep it playful, vivid, and genuinely funny without being mean, threatening, or insulting.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `The child wants to eat: ${food}. ${styleHint}\nWrite 9 to 18 words. Make it punchy and unexpected. Avoid sounding anything like these recent replies:\n${recentReplyList}`,
          },
        ],
      },
    ]);
    const reply = (payload.output_text || "").trim();

    if (reply && !hasRecentReply(reply)) {
      await storeFallbackResponse({
        requestType: "food",
        contextKey: buildFoodContextKey(food),
        reply,
        template: createFoodFallbackTemplate(reply, food),
      });
      return rememberAndReturn(reply);
    }
  }

  const fallback = await fallbackReply(food);
  return rememberAndReturn(fallback.text, fallback.key);
}

async function createRideReply({ time, from, to, purpose }) {
  if (!OPENAI_API_KEY) {
    const fallback = await getRideFallbackReply({ time, from, to, purpose });
    return rememberAndReturn(fallback.text, fallback.key);
  }

  const recentReplyList = recentReplies.length
    ? recentReplies.map((reply) => `- ${reply.text}`).join("\n")
    : "None";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = await requestOpenAIResponse([
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You write exactly one short, playful, family-safe sentence confirming a child's ride request. Mention the ride time, the route, and the purpose. Keep it light and useful, not sarcastic or mean.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Ride request: at ${time}, from ${from}, to ${to}, for ${purpose}. Avoid sounding too similar to these recent replies:\n${recentReplyList}`,
          },
        ],
      },
    ]);
    const reply = (payload.output_text || "").trim();

    if (reply && !hasRecentReply(reply)) {
      await storeFallbackResponse({
        requestType: "ride",
        contextKey: buildRideContextKey({ time, from, to, purpose }),
        reply,
        template: createRideFallbackTemplate(reply, { time, from, to, purpose }),
      });
      return rememberAndReturn(reply);
    }
  }

  const fallback = await getRideFallbackReply({ time, from, to, purpose });
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
        const fallback = await fallbackReply(food);
        sendJson(response, 200, { reply: rememberAndReturn(fallback.text, fallback.key), fallback: true });
      }
      return;
    }

    if (request.method === "GET" && pathname === "/api/requests") {
      const summary = await listRequests();
      sendJson(response, 200, { requests: summary.activeRequests });
      return;
    }

    if (request.method === "GET" && pathname === "/api/daily-check-in") {
      const deviceId = String(url.searchParams.get("deviceId") || "").trim();
      const [checkIn, todayCheckIns] = await Promise.all([
        findTodayDailyCheckInByDevice(deviceId),
        listTodayDailyCheckIns(),
      ]);
      sendJson(response, 200, { checkIn, todayCheckIns });
      return;
    }

    if (request.method === "GET" && pathname === "/api/lunch-break-unknown-response") {
      const reply = await getLunchBreakUnknownResponse();
      sendJson(response, 200, { reply });
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
        requestType: parsed.requestType,
        rideTime: parsed.rideTime,
        rideFrom: parsed.rideFrom,
        rideTo: parsed.rideTo,
        purpose: parsed.purpose,
      });

      if (!requestRecord) {
        sendJson(response, 400, { error: "Required request fields are missing." });
        return;
      }

      sendJson(response, 201, { request: requestRecord });
      return;
    }

    if (request.method === "POST" && pathname === "/api/daily-check-in") {
      const body = await readRequestBody(request);
      const parsed = JSON.parse(body || "{}");
      const checkIn = await saveTodayDailyCheckIn({
        deviceId: parsed.deviceId,
        role: parsed.role,
        name: parsed.name,
        lunchBreakTime: parsed.lunchBreakTime,
      });

      if (!checkIn) {
        sendJson(response, 400, { error: "Required daily check-in fields are missing." });
        return;
      }

      const todayCheckIns = await listTodayDailyCheckIns();
      sendJson(response, 201, { checkIn, todayCheckIns });
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
          requestType: parsed.requestType,
          rideTime: parsed.rideTime,
          rideFrom: parsed.rideFrom,
          rideTo: parsed.rideTo,
          purpose: parsed.purpose,
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

async function seedLunchBreakUnknownPoolCommand() {
  await initializeDatabase();
  const stored = await ensureLunchBreakUnknownPool();
  console.log(`Stored lunch-break unknown responses: ${stored.length}`);
}

async function startServer() {
  try {
    await initializeDatabase();
    await ensureLunchBreakUnknownPool();
    server.listen(PORT, HOST, () => {
      console.log(
        `OpenAI configured: ${OPENAI_API_KEY ? "yes" : "no"}; model: ${OPENAI_MODEL}; persistence: ${
          pool ? "postgres" : "local-json"
        }`
      );
      console.log(`I want ... running at http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize persistence layer:", error);
    process.exit(1);
  }
}

if (process.argv.includes("--seed-lunch-break-unknown-pool")) {
  seedLunchBreakUnknownPoolCommand()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed lunch-break unknown pool:", error);
      process.exit(1);
    });
} else {
  startServer();
}
