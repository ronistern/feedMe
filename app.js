const STORAGE_KEY = "feedme-today-state";

const defaultState = {
  menu: {
    lunch: "",
    lunchNote: "",
    dinner: "",
    dinnerNote: "",
  },
  rideSuggestions: {
    purpose: [],
    from: [],
    to: [],
  },
  requests: [],
};

const roleTabs = document.querySelectorAll("[data-view-target]");
const viewPanels = document.querySelectorAll("[data-view-panel]");
const requestForm = document.getElementById("request-form");
const rideRequestForm = document.getElementById("ride-request-form");
const plannerForm = document.getElementById("planner-form");
const requestInput = document.getElementById("request-input");
const rideTimeInput = document.getElementById("ride-time-input");
const rideFromInput = document.getElementById("ride-from-input");
const rideToInput = document.getElementById("ride-to-input");
const ridePurposeInput = document.getElementById("ride-purpose-input");
const ridePurposeOptions = document.getElementById("ride-purpose-options");
const rideFromOptions = document.getElementById("ride-from-options");
const rideToOptions = document.getElementById("ride-to-options");
const mealTypeInputs = document.querySelectorAll('input[name="mealType"]');
const requestList = document.getElementById("request-list");
const emptyRequests = document.getElementById("empty-requests");
const requestStatus = document.getElementById("request-status");
const clearRequestsButton = document.getElementById("clear-requests");
const analysisLink = document.getElementById("analysis-link");
const requestSubmitButton = document.getElementById("request-submit-button");
const rideSubmitButton = document.getElementById("ride-submit-button");
const cancelRequestEditButton = document.getElementById("cancel-request-edit");
const kidRequestList = document.getElementById("kid-request-list");
const emptyKidRequests = document.getElementById("empty-kid-requests");
const suggestionButtons = document.querySelectorAll("[data-suggestion]");
const foodRequestPanel = document.getElementById("food-request-panel");
const rideRequestPanel = document.getElementById("ride-request-panel");
const replyOutput = document.getElementById("reply-output");
const replyTitle = document.getElementById("reply-title");
const thinkingIndicator = document.getElementById("thinking-indicator");
const llmStatusBadge = document.getElementById("llm-status-badge");
const llmStatusText = document.getElementById("llm-status-text");
const onboardingOverlay = document.getElementById("onboarding-overlay");
const profileStatus = document.getElementById("profile-status");
const profileSubmitButton = document.getElementById("profile-submit");
const profileNameGrid = document.getElementById("profile-name-grid");
const profileRoleInputs = document.querySelectorAll('input[name="profileRole"]');
const headerNamePicker = document.getElementById("header-name-picker");
const parentCodeSection = document.getElementById("parent-code-section");
const parentCodeInput = document.getElementById("parent-code-input");
const clientFallbackReplies = [
  "That order just made the frying pan raise an eyebrow.",
  "Interesting choice. The kitchen staff is now in dramatic negotiations.",
  "That meal request has been forwarded to the Department of Snack Affairs.",
  "Bold move. The fridge is pretending it did not hear that.",
  "Strong choice. Someone tell the plates to brace themselves.",
];
const BRITISH_VOICE_NAMES = [
  "Google UK English Female",
  "Google UK English Male",
  "Microsoft Sonia Online (Natural)",
  "Microsoft Ryan Online (Natural)",
  "Serena",
  "Daniel",
  "Kate",
];
const AMERICAN_VOICE_NAMES = [
  "Microsoft Jenny Online (Natural)",
  "Microsoft Aria Online (Natural)",
  "Samantha",
  "Karen",
  "Google US English",
  "Aaron",
  "Nicky",
];
const SESSION_KEY = "feedme-profile";
const PARENT_CODE = "!!!";
const GANDALF_AUDIO_PATH = "/assets/you-shall-not-pass.mp3";
const PROFILES = {
  kids: ["Ofer", "Amit", "Nitzan"],
  parent: ["Adi", "Roni"],
};
const RIDE_SUGGESTION_LIMIT = 12;

let state = loadState();
let availableVoices = [];
let activeProfile = loadProfile();
let replyRevealTimeoutId = null;
let speechPrimed = false;
let editingRequestId = null;
let nextReplyAccent = "british";

function setSelectedMealType(mealType) {
  const normalizedMealType = mealType === "dinner" ? "dinner" : "lunch";
  mealTypeInputs.forEach((input) => {
    input.checked = input.value === normalizedMealType;
  });
}

function getSelectedMealType() {
  const selected = Array.from(mealTypeInputs).find((input) => input.checked);
  return selected?.value === "dinner" ? "dinner" : "lunch";
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  availableVoices = window.speechSynthesis.getVoices();
}

function getPreferredVoice() {
  if (!availableVoices.length) {
    return null;
  }

  for (const voiceName of AMERICAN_VOICE_NAMES) {
    const match = availableVoices.find((voice) => voice.name === voiceName);
    if (match) {
      return match;
    }
  }

  const localEnglishVoice = availableVoices.find(
    (voice) =>
      voice.lang.toLowerCase().startsWith("en") &&
      voice.localService
  );
  if (localEnglishVoice) {
    return localEnglishVoice;
  }

  return availableVoices.find((voice) => voice.lang.toLowerCase().startsWith("en")) || availableVoices[0];
}

function findVoiceByNames(voiceNames) {
  for (const voiceName of voiceNames) {
    const match = availableVoices.find((voice) => voice.name === voiceName);
    if (match) {
      return match;
    }
  }

  return null;
}

function findVoiceByLangPrefix(langPrefix) {
  return (
    availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(langPrefix) && voice.localService) ||
    availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(langPrefix)) ||
    null
  );
}

function getBritishVoice() {
  return findVoiceByNames(BRITISH_VOICE_NAMES) || findVoiceByLangPrefix("en-gb") || getPreferredVoice();
}

function getAmericanVoice() {
  return findVoiceByNames(AMERICAN_VOICE_NAMES) || findVoiceByLangPrefix("en-us") || getPreferredVoice();
}

function getNextReplyVoiceStyle() {
  const accent = nextReplyAccent;
  nextReplyAccent = nextReplyAccent === "british" ? "hillbilly" : "british";

  if (accent === "british") {
    const voice = getBritishVoice();
    return {
      voice,
      lang: voice?.lang || "en-GB",
      rate: 0.94,
      pitch: 1,
    };
  }

  const voice = getAmericanVoice();
  return {
    voice,
    lang: voice?.lang || "en-US",
    rate: 0.88,
    pitch: 0.82,
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function primeSpeech() {
  if (speechPrimed || !("speechSynthesis" in window)) {
    return;
  }

  speechPrimed = true;
  const utterance = new SpeechSynthesisUtterance(" ");
  utterance.volume = 0;
  utterance.rate = 1;
  utterance.pitch = 1;
  const preferredVoice = getBritishVoice() || getPreferredVoice();

  if (preferredVoice) {
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  window.setTimeout(() => {
    window.speechSynthesis.cancel();
  }, 20);
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return structuredClone(defaultState);
    }

    const parsed = JSON.parse(saved);
    return {
      requests: [],
      menu: {
        ...defaultState.menu,
        ...parsed.menu,
      },
      rideSuggestions: {
        ...defaultState.rideSuggestions,
        ...parsed.rideSuggestions,
      },
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      menu: state.menu,
      rideSuggestions: state.rideSuggestions,
    })
  );
}

function normalizeSuggestionValue(value, maxLength = 80) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function saveRideSuggestion(type, value, maxLength = 80) {
  const normalized = normalizeSuggestionValue(value, maxLength);
  if (!normalized) {
    return;
  }

  const current = Array.isArray(state.rideSuggestions[type]) ? state.rideSuggestions[type] : [];
  state.rideSuggestions[type] = [
    normalized,
    ...current.filter((entry) => entry.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, RIDE_SUGGESTION_LIMIT);
}

function renderDatalist(element, values) {
  if (!element) {
    return;
  }

  element.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    element.append(option);
  });
}

function renderRideSuggestions() {
  renderDatalist(ridePurposeOptions, state.rideSuggestions.purpose || []);
  renderDatalist(rideFromOptions, state.rideSuggestions.from || []);
  renderDatalist(rideToOptions, state.rideSuggestions.to || []);
}

function loadProfile() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) {
      return null;
    }

    const parsed = JSON.parse(saved);
    if (!parsed || !PROFILES[parsed.role]?.includes(parsed.name)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  activeProfile = profile;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
}

function clearProfile() {
  activeProfile = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function setActiveView(viewName) {
  roleTabs.forEach((tab) => {
    const isActive = tab.dataset.viewTarget === viewName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
  });

  viewPanels.forEach((panel) => {
    const isActive = panel.dataset.viewPanel === viewName;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  if (analysisLink) {
    analysisLink.classList.toggle("is-hidden", viewName !== "parent");
  }
}

function updateMealDisplays() {
  const lunch = state.menu.lunch.trim();
  const dinner = state.menu.dinner.trim();
  const lunchNote = state.menu.lunchNote.trim();
  const dinnerNote = state.menu.dinnerNote.trim();

  document.querySelector('[data-meal-display="lunch"]').textContent =
    lunch || "No lunch planned yet";
  document.querySelector('[data-note-display="lunch"]').textContent =
    lunch ? lunchNote || "No extra note for lunch today." : "Add the lunch plan in the parent view.";

  document.querySelector('[data-meal-display="dinner"]').textContent =
    dinner || "No dinner planned yet";
  document.querySelector('[data-note-display="dinner"]').textContent =
    dinner ? dinnerNote || "No extra note for dinner today." : "Add the dinner plan in the parent view.";

  plannerForm.lunch.value = state.menu.lunch;
  plannerForm.lunchNote.value = state.menu.lunchNote;
  plannerForm.dinner.value = state.menu.dinner;
  plannerForm.dinnerNote.value = state.menu.dinnerNote;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isToday(timestamp) {
  return getDateKey(timestamp) === getDateKey(Date.now());
}

function resetRequestEditing() {
  editingRequestId = null;
  requestForm.reset();
  rideRequestForm.reset();
  setSelectedMealType("lunch");
  requestSubmitButton.textContent = "Send";
  rideSubmitButton.textContent = "Send";
  cancelRequestEditButton.classList.add("is-hidden");
}

function startRequestEditing(request) {
  editingRequestId = request.id;
  if (request.requestType === "ride") {
    rideTimeInput.value = request.rideTime || "";
    rideFromInput.value = request.rideFrom || "";
    rideToInput.value = request.rideTo || "";
    ridePurposeInput.value = request.name || "";
    rideSubmitButton.textContent = "Save";
    foodRequestPanel.open = false;
    rideRequestPanel.open = true;
    rideTimeInput.focus();
  } else {
    requestInput.value = request.name;
    setSelectedMealType(request.mealType || "lunch");
    requestSubmitButton.textContent = "Save";
    rideRequestPanel.open = false;
    foodRequestPanel.open = true;
    requestInput.focus();
    requestInput.select();
  }
  cancelRequestEditButton.classList.remove("is-hidden");
  requestStatus.textContent = `Editing ${formatRequestHeadline(request)}.`;
}

function renderRequestReply(container, request) {
  const reply = document.createElement("p");
  reply.className = "request-reply";
  reply.textContent = request.reply || "";
  container.append(reply);

  if (request.snottyRemark) {
    const remark = document.createElement("p");
    remark.className = "request-remark";
    remark.textContent = request.snottyRemark;
    container.append(remark);
  }
}

function formatMealType(mealType) {
  return mealType === "dinner" ? "Dinner" : "Lunch";
}

function formatRequestHeadline(request) {
  if (request.requestType === "ride") {
    return `ride for ${request.name}`;
  }

  return `${formatMealType(request.mealType)}: ${request.name}`;
}

function formatRequestDetails(request) {
  if (request.requestType === "ride") {
    return `Ride at ${request.rideTime} from ${request.rideFrom} to ${request.rideTo}`;
  }

  return `${formatMealType(request.mealType)}: ${request.name}`;
}

function formatRequestSubdetails(request) {
  if (request.requestType === "ride") {
    return `Purpose: ${request.name}`;
  }

  return "";
}

function getCurrentKidRequests() {
  if (!activeProfile || activeProfile.role !== "kids") {
    return [];
  }

  return state.requests
    .filter((request) => request.childName === activeProfile.name && isToday(request.createdAt))
    .sort((left, right) => right.createdAt - left.createdAt);
}

function renderKidRequests() {
  kidRequestList.innerHTML = "";

  const kidRequests = getCurrentKidRequests();
  if (!kidRequests.length) {
    if (editingRequestId) {
      resetRequestEditing();
    }
    emptyKidRequests.classList.remove("is-hidden");
    return;
  }

  emptyKidRequests.classList.add("is-hidden");

  kidRequests.forEach((request) => {
    const item = document.createElement("li");
    item.className = "request-item";

    const content = document.createElement("div");

    const name = document.createElement("p");
    name.className = "request-name";
    name.textContent = formatRequestDetails(request);

    const subdetails = formatRequestSubdetails(request);
    if (subdetails) {
      const meta = document.createElement("p");
      meta.className = "request-meta";
      meta.textContent = subdetails;
      content.append(name, meta);
    } else {
      content.append(name);
    }

    const time = document.createElement("p");
    time.className = "request-time";
    time.textContent = request.updatedAt
      ? `Updated at ${formatTime(request.updatedAt)}`
      : `Sent at ${formatTime(request.createdAt)}`;

    content.append(time);

    const actions = document.createElement("div");
    actions.className = "request-actions";

    const editButton = document.createElement("button");
    editButton.className = "request-edit";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      startRequestEditing(request);
    });

    const removeButton = document.createElement("button");
    removeButton.className = "request-remove";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove request for ${request.name}`);
    removeButton.addEventListener("click", async () => {
      await archiveRequest(request.id);
    });

    actions.append(editButton, removeButton);
    item.append(content, actions);
    kidRequestList.append(item);
  });

  if (editingRequestId && !kidRequests.some((request) => request.id === editingRequestId)) {
    resetRequestEditing();
  }
}

function renderRequests() {
  requestList.innerHTML = "";
  renderKidRequests();

  if (!state.requests.length) {
    emptyRequests.classList.remove("is-hidden");
    return;
  }

  emptyRequests.classList.add("is-hidden");

  state.requests
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .forEach((request) => {
      const item = document.createElement("li");
      item.className = "request-item";

      const content = document.createElement("div");

      const name = document.createElement("p");
      name.className = "request-name";
      name.textContent = formatRequestDetails(request);

      const child = document.createElement("p");
      child.className = "request-child";
      child.textContent = request.childName;

      const subdetails = formatRequestSubdetails(request);
      const meta = subdetails
        ? Object.assign(document.createElement("p"), {
            className: "request-meta",
            textContent: subdetails,
          })
        : null;

      const time = document.createElement("p");
      time.className = "request-time";
      time.textContent = request.updatedAt
        ? `Updated at ${formatTime(request.updatedAt)}`
        : `Sent at ${formatTime(request.createdAt)}`;

      const removeButton = document.createElement("button");
      removeButton.className = "request-remove";
      removeButton.type = "button";
      removeButton.textContent = "Done";
      removeButton.setAttribute("aria-label", `Remove request for ${request.name}`);
      removeButton.addEventListener("click", async () => {
        await archiveRequest(request.id);
      });

      content.append(child, name);
      if (meta) {
        content.append(meta);
      }
      content.append(time);
      renderRequestReply(content, request);
      item.append(content, removeButton);
      requestList.append(item);
    });

}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

async function refreshRequests() {
  try {
    const payload = await fetchJson("/api/requests");
    state.requests = Array.isArray(payload.requests) ? payload.requests : [];
    renderRequests();
  } catch {
    requestStatus.textContent = "Could not load saved requests from the server.";
  }
}

async function archiveRequest(requestId) {
  try {
    const payload = await fetchJson(`/api/requests/${requestId}/archive`, {
      method: "POST",
    });
    state.requests = Array.isArray(payload.requests) ? payload.requests : [];
    renderRequests();
  } catch {
    requestStatus.textContent = "Could not archive that request right now.";
  }
}

async function saveRequest(payload) {
  const body =
    payload.requestType === "ride"
      ? {
          childName: activeProfile?.name || "",
          requestType: "ride",
          rideTime: payload.rideTime,
          rideFrom: payload.rideFrom,
          rideTo: payload.rideTo,
          purpose: payload.purpose,
        }
      : {
          childName: activeProfile?.name || "",
          food: payload.food,
          mealType: payload.mealType,
          requestType: "food",
        };

  if (editingRequestId) {
    const result = await fetchJson(`/api/requests/${editingRequestId}/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    state.requests = state.requests.map((request) =>
      request.id === result.request.id ? result.request : request
    );
    return result.request;
  }

  const result = await fetchJson("/api/requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  state.requests.unshift(result.request);
  return result.request;
}

function updateReplyCard(title, message) {
  if (!replyTitle || !replyOutput) {
    return;
  }

  const hasMessage = Boolean(message && message.trim());
  replyTitle.textContent = title;
  replyTitle.classList.toggle("is-hidden", !hasMessage);
  replyOutput.textContent = message;
}

function setReplyThinking(isThinking) {
  if (!thinkingIndicator) {
    return;
  }

  thinkingIndicator.classList.toggle("is-hidden", !isThinking);
}

function updateLlmStatus(source) {
  if (!llmStatusBadge || !llmStatusText) {
    return;
  }

  if (!source) {
    llmStatusBadge.classList.add("is-hidden");
    llmStatusBadge.classList.remove("is-online", "is-offline");
    llmStatusText.textContent = "";
    return;
  }

  const isOnline = source === "openai";
  llmStatusBadge.classList.remove("is-hidden");
  llmStatusBadge.classList.toggle("is-online", isOnline);
  llmStatusBadge.classList.toggle("is-offline", !isOnline);
  llmStatusText.textContent = isOnline ? "OpenAI" : "Fallback";
  llmStatusBadge.setAttribute(
    "aria-label",
    isOnline ? "Response generated by OpenAI" : "Response generated by fallback text"
  );
}

function scheduleReplyReveal(title, message, source, delay = 0) {
  if (replyRevealTimeoutId) {
    window.clearTimeout(replyRevealTimeoutId);
  }

  updateReplyCard("", "");
  updateLlmStatus("");
  if (delay <= 0) {
    updateReplyCard(title, message);
    updateLlmStatus(source);
    replyRevealTimeoutId = null;
    return;
  }

  replyRevealTimeoutId = window.setTimeout(() => {
    updateReplyCard(title, message);
    updateLlmStatus(source);
    replyRevealTimeoutId = null;
  }, delay);
}

function renderProfileNames(role) {
  profileNameGrid.innerHTML = "";

  if (!role || !PROFILES[role]) {
    return;
  }

  PROFILES[role].forEach((name, index) => {
    const label = document.createElement("label");
    label.className = "name-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "profileName";
    input.value = name;
    if (index === 0) {
      input.checked = true;
    }

    const span = document.createElement("span");
    span.textContent = name;

    label.append(input, span);
    profileNameGrid.append(label);
  });
}

function renderHeaderNamePicker(role, selectedName) {
  headerNamePicker.innerHTML = "";

  if (!role || !PROFILES[role]) {
    return;
  }

  PROFILES[role].forEach((name) => {
    const label = document.createElement("label");
    label.className = "name-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "headerProfileName";
    input.value = name;
    input.checked = name === selectedName;
    input.addEventListener("change", () => {
      if (!activeProfile) {
        return;
      }

      saveProfile({ role, name });
      applyProfile(activeProfile);
    });

    const span = document.createElement("span");
    span.textContent = name;

    label.append(input, span);
    headerNamePicker.append(label);
  });
}

function getSelectedProfileRole() {
  const selected = Array.from(profileRoleInputs).find((input) => input.checked);
  return selected ? selected.value : "";
}

function getSelectedProfileName() {
  const selected = profileNameGrid.querySelector('input[name="profileName"]:checked');
  return selected ? selected.value : "";
}

function applyProfile(profile) {
  if (!profile) {
    onboardingOverlay.classList.remove("is-hidden");
    document.body.classList.add("is-locked");
    headerNamePicker.innerHTML = "";
    setActiveView("kids");
    return;
  }

  onboardingOverlay.classList.add("is-hidden");
  document.body.classList.remove("is-locked");
  renderHeaderNamePicker(profile.role, profile.name);
  setActiveView(profile.role);
}

function speakMessage(message, options = {}) {
  if (!("speechSynthesis" in window) || !message) {
    options.onStart?.();
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let started = false;
    const utterance = new SpeechSynthesisUtterance(message);
    const preferredVoice = options.voice || getPreferredVoice();

    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang;
    } else {
      utterance.lang = options.lang || "en-US";
    }

    utterance.rate = options.rate ?? 0.96;
    utterance.pitch = options.pitch ?? 1.05;
    utterance.volume = options.volume ?? 1;
    utterance.onstart = () => {
      started = true;
      options.onStart?.();
      resolve(true);
    };
    utterance.onerror = () => {
      if (!started) {
        options.onStart?.();
        resolve(false);
      }
    };

    const speakUtterance = async () => {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
        await wait(60);
      }

      window.speechSynthesis.speak(utterance);

      window.setTimeout(() => {
        if (!started) {
          options.onStart?.();
          resolve(false);
        }
      }, 400);
    };

    void speakUtterance();
  });
}

function speakReply(message, options = {}) {
  const style = getNextReplyVoiceStyle();
  return speakMessage(message, {
    ...style,
    ...options,
  });
}

async function playAudioOnce(source) {
  const audio = new Audio(source);
  audio.preload = "auto";
  await audio.play();
}

async function playGandalfLine() {
  try {
    await playAudioOnce(GANDALF_AUDIO_PATH);
  } catch {
    await speakMessage("You shall not pass", {
      voice: getGandalfVoice(),
      rate: 0.84,
      pitch: 0.66,
      volume: 1,
    });
  }
}

function getGandalfVoice() {
  if (!availableVoices.length) {
    return null;
  }

  return (
    availableVoices.find(
      (voice) =>
        voice.lang.toLowerCase().startsWith("en") &&
        (/david|daniel|fred|george|male/i.test(voice.name) ||
          voice.name.includes("Google UK English Male") ||
          voice.name.includes("Microsoft Ryan"))
    ) || getPreferredVoice()
  );
}

function getClientFallbackReply(food, childName) {
  const index = Math.floor(Math.random() * clientFallbackReplies.length);
  return `${childName}, you want ${food}? ${clientFallbackReplies[index]}`;
}

function getClientRideFallbackReply({ time, from, to, purpose }, childName) {
  return `${childName}, ride noted for ${time} from ${from} to ${to} for ${purpose}.`;
}

async function submitFoodRequest(rawValue) {
  const name = rawValue.trim();
  const childName = activeProfile?.name || "";
  const mealType = getSelectedMealType();
  const mealLabel = formatMealType(mealType).toLowerCase();

  if (!activeProfile || activeProfile.role !== "kids") {
    requestStatus.textContent = "Please enter as a kid before sending a food request.";
    return;
  }

  if (!name) {
    requestStatus.textContent = "Please type a food idea first.";
    return;
  }

  requestForm.reset();
  setSelectedMealType("lunch");
  requestStatus.textContent = editingRequestId
    ? `Saving ${mealLabel} request for ${name}...`
    : `${childName} asked for ${name} for ${mealLabel}.`;
  setReplyThinking(true);
  updateReplyCard("", "");

  try {
    const request = await saveRequest({
      requestType: "food",
      food: name,
      mealType,
    });
    const chefMessage = request.snottyRemark
      ? `${request.reply} ${request.snottyRemark}`
      : request.reply;
    renderRequests();
    const actionLabel = editingRequestId ? "updated" : "asked for";
    requestStatus.textContent = `${childName} ${actionLabel} ${name} for ${mealLabel}.`;
    resetRequestEditing();
    requestInput.focus();
    await speakReply(chefMessage, {
      onStart: () => {
        setReplyThinking(false);
        scheduleReplyReveal("Chef Bot says", chefMessage, request.replySource || "fallback");
      },
    });
  } catch {
    const fallbackReply = getClientFallbackReply(name, childName);
    setReplyThinking(false);
    await speakReply(fallbackReply, {
      onStart: () => {
        scheduleReplyReveal("Chef Bot dropped the spoon", fallbackReply, "fallback");
      },
    });
    requestStatus.textContent = "Could not save that request to the server.";
  }
}

async function submitRideRequest({ rideTime, rideFrom, rideTo, purpose }) {
  const childName = activeProfile?.name || "";
  const normalizedRideTime = rideTime.trim();
  const normalizedRideFrom = rideFrom.trim();
  const normalizedRideTo = rideTo.trim();
  const normalizedPurpose = purpose.trim();

  if (!activeProfile || activeProfile.role !== "kids") {
    requestStatus.textContent = "Please enter as a kid before sending a ride request.";
    return;
  }

  if (!normalizedRideTime || !normalizedRideFrom || !normalizedRideTo || !normalizedPurpose) {
    requestStatus.textContent = "Please fill in the time, from, to, and purpose.";
    return;
  }

  rideRequestForm.reset();
  requestStatus.textContent = editingRequestId
    ? `Saving ride request for ${normalizedPurpose}...`
    : `${childName} asked for a ride at ${normalizedRideTime}.`;
  setReplyThinking(true);
  updateReplyCard("", "");

  try {
    const request = await saveRequest({
      requestType: "ride",
      rideTime: normalizedRideTime,
      rideFrom: normalizedRideFrom,
      rideTo: normalizedRideTo,
      purpose: normalizedPurpose,
    });
    saveRideSuggestion("purpose", normalizedPurpose, 60);
    saveRideSuggestion("from", normalizedRideFrom, 80);
    saveRideSuggestion("to", normalizedRideTo, 80);
    saveState();
    renderRideSuggestions();
    const chefMessage = request.reply;
    renderRequests();
    requestStatus.textContent = editingRequestId
      ? `Ride request updated for ${normalizedPurpose}.`
      : `${childName} asked for a ride at ${normalizedRideTime}.`;
    resetRequestEditing();
    rideTimeInput.focus();
    await speakReply(chefMessage, {
      onStart: () => {
        setReplyThinking(false);
        scheduleReplyReveal("Chef Bot says", chefMessage, request.replySource || "fallback");
      },
    });
  } catch {
    const fallbackReply = getClientRideFallbackReply(
      {
        time: normalizedRideTime,
        from: normalizedRideFrom,
        to: normalizedRideTo,
        purpose: normalizedPurpose,
      },
      childName
    );
    setReplyThinking(false);
    await speakReply(fallbackReply, {
      onStart: () => {
        scheduleReplyReveal("Chef Bot dropped the spoon", fallbackReply, "fallback");
      },
    });
    requestStatus.textContent = "Could not save that ride request to the server.";
  }
}

roleTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const role = tab.dataset.viewTarget;
    const currentName = activeProfile && activeProfile.role === role ? activeProfile.name : PROFILES[role][0];

    saveProfile({ role, name: currentName });
    applyProfile(activeProfile);
  });

  tab.addEventListener("keydown", (event) => {
    const orderedTabs = Array.from(roleTabs);
    const currentIndex = orderedTabs.indexOf(tab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % orderedTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + orderedTabs.length) % orderedTabs.length;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = orderedTabs[nextIndex];
    const role = nextTab.dataset.viewTarget;
    const currentName = activeProfile && activeProfile.role === role ? activeProfile.name : PROFILES[role][0];
    saveProfile({ role, name: currentName });
    applyProfile(activeProfile);
    nextTab.focus();
  });
});

suggestionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    primeSpeech();
    requestInput.value = button.dataset.suggestion;
    foodRequestPanel.open = true;
    void submitFoodRequest(button.dataset.suggestion || "");
  });
});

requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  primeSpeech();
  void submitFoodRequest(requestInput.value);
});

rideRequestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  primeSpeech();
  void submitRideRequest({
    rideTime: rideTimeInput.value,
    rideFrom: rideFromInput.value,
    rideTo: rideToInput.value,
    purpose: ridePurposeInput.value,
  });
});

cancelRequestEditButton.addEventListener("click", () => {
  resetRequestEditing();
  requestStatus.textContent = "Edit cancelled.";
});

plannerForm.addEventListener("submit", (event) => {
  event.preventDefault();

  state.menu = {
    lunch: plannerForm.lunch.value.trim(),
    lunchNote: plannerForm.lunchNote.value.trim(),
    dinner: plannerForm.dinner.value.trim(),
    dinnerNote: plannerForm.dinnerNote.value.trim(),
  };

  saveState();
  updateMealDisplays();
  setActiveView(activeProfile?.role || "parent");
  requestStatus.textContent = "Today's menu is updated.";
});

clearRequestsButton.addEventListener("click", () => {
  void (async () => {
    try {
      const payload = await fetchJson("/api/requests/archive-all", {
        method: "POST",
      });
      state.requests = Array.isArray(payload.requests) ? payload.requests : [];
      renderRequests();
    } catch {
      requestStatus.textContent = "Could not archive requests right now.";
    }
  })();
});

if (analysisLink) {
  analysisLink.addEventListener("click", (event) => {
    if (!activeProfile || activeProfile.role !== "parent") {
      event.preventDefault();
      profileStatus.textContent = "Only parents can open the analysis page.";
    }
  });
}

profileRoleInputs.forEach((input) => {
  input.addEventListener("change", () => {
    renderProfileNames(input.value);
    parentCodeSection.classList.toggle("is-hidden", input.value !== "parent");
    if (input.value !== "parent") {
      parentCodeInput.value = "";
    }
    profileStatus.textContent = "";
  });
});

profileSubmitButton.addEventListener("click", () => {
  primeSpeech();
  const role = getSelectedProfileRole();
  const name = getSelectedProfileName();

  if (!role) {
    profileStatus.textContent = "Choose whether you are a kid or a parent first.";
    return;
  }

  if (!name) {
    profileStatus.textContent = "Choose your name first.";
    return;
  }

  if (role === "parent" && parentCodeInput.value !== PARENT_CODE) {
    profileStatus.textContent = "You shall not pass";
    void playGandalfLine();
    parentCodeInput.focus();
    parentCodeInput.select();
    return;
  }

  saveProfile({ role, name });
  profileStatus.textContent = "";
  parentCodeInput.value = "";
  applyProfile(activeProfile);
});

loadVoices();
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

updateMealDisplays();
renderRideSuggestions();
void refreshRequests();
applyProfile(activeProfile);
setSelectedMealType("lunch");
