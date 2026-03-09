const STORAGE_KEY = "feedme-today-state";

const defaultState = {
  menu: {
    lunch: "",
    lunchNote: "",
    dinner: "",
    dinnerNote: "",
  },
  requests: [],
};

const roleTabs = document.querySelectorAll("[data-view-target]");
const viewPanels = document.querySelectorAll("[data-view-panel]");
const requestForm = document.getElementById("request-form");
const plannerForm = document.getElementById("planner-form");
const requestInput = document.getElementById("request-input");
const requestList = document.getElementById("request-list");
const emptyRequests = document.getElementById("empty-requests");
const requestStatus = document.getElementById("request-status");
const clearRequestsButton = document.getElementById("clear-requests");
const suggestionButtons = document.querySelectorAll("[data-suggestion]");
const replyOutput = document.getElementById("reply-output");
const replyTitle = document.getElementById("reply-title");
const thinkingIndicator = document.getElementById("thinking-indicator");
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
const preferredVoiceNames = [
  "Samantha",
  "Karen",
  "Moira",
  "Google US English",
  "Google UK English Female",
  "Microsoft Aria Online (Natural)",
  "Microsoft Jenny Online (Natural)",
];
const SESSION_KEY = "feedme-profile";
const PARENT_CODE = "!!!";
const GANDALF_AUDIO_PATH = "/assets/you-shall-not-pass.mp3";
const PROFILES = {
  kids: ["Ofer", "Amit", "Nitzan"],
  parent: ["Adi", "Roni"],
};

let state = loadState();
let availableVoices = [];
let activeProfile = loadProfile();
let replyRevealTimeoutId = null;
let speechPrimed = false;

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

  for (const voiceName of preferredVoiceNames) {
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
  const preferredVoice = getPreferredVoice();

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
      menu: {
        ...defaultState.menu,
        ...parsed.menu,
      },
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function renderRequests() {
  requestList.innerHTML = "";

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
      name.textContent = request.name;

      const child = document.createElement("p");
      child.className = "request-child";
      child.textContent = request.childName;

      const time = document.createElement("p");
      time.className = "request-time";
      time.textContent = `Sent at ${formatTime(request.createdAt)}`;

      const reply = document.createElement("p");
      reply.className = "request-reply";
      reply.textContent = request.reply || "";

      const removeButton = document.createElement("button");
      removeButton.className = "request-remove";
      removeButton.type = "button";
      removeButton.textContent = "Done";
      removeButton.setAttribute("aria-label", `Remove request for ${request.name}`);
      removeButton.addEventListener("click", () => {
        state.requests = state.requests.filter((entry) => entry.id !== request.id);
        saveState();
        renderRequests();
      });

      content.append(child, name, time, reply);
      item.append(content, removeButton);
      requestList.append(item);
    });
}

async function fetchCheekyReply(food) {
  const response = await fetch("/api/cheeky-response", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ food }),
  });

  if (!response.ok) {
    throw new Error("Cheeky response failed");
  }

  return response.json();
}

function updateReplyCard(title, message) {
  const hasMessage = Boolean(message && message.trim());
  replyTitle.textContent = title;
  replyTitle.classList.toggle("is-hidden", !hasMessage);
  replyOutput.textContent = message;
}

function setReplyThinking(isThinking) {
  thinkingIndicator.classList.toggle("is-hidden", !isThinking);
}

function scheduleReplyReveal(title, message, delay = 0) {
  if (replyRevealTimeoutId) {
    window.clearTimeout(replyRevealTimeoutId);
  }

  updateReplyCard("", "");
  if (delay <= 0) {
    updateReplyCard(title, message);
    replyRevealTimeoutId = null;
    return;
  }

  replyRevealTimeoutId = window.setTimeout(() => {
    updateReplyCard(title, message);
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
      utterance.lang = "en-US";
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
  return speakMessage(message, options);
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

async function submitRequest(rawValue) {
  const name = rawValue.trim();
  const childName = activeProfile?.name || "";

  if (!activeProfile || activeProfile.role !== "kids") {
    requestStatus.textContent = "Please enter as a kid before sending a food request.";
    return;
  }

  if (!name) {
    requestStatus.textContent = "Please type a food idea first.";
    return;
  }

  const request = {
    id: crypto.randomUUID(),
    childName,
    name,
    createdAt: Date.now(),
    reply: "",
  };

  state.requests.push(request);

  saveState();
  renderRequests();
  requestForm.reset();
  requestStatus.textContent = `${childName} asked for ${name}.`;
  setReplyThinking(true);
  updateReplyCard("", "");
  requestInput.focus();

  try {
    const result = await fetchCheekyReply(name);
    request.reply = result.reply;
    saveState();
    renderRequests();
    await speakReply(result.reply, {
      onStart: () => {
        setReplyThinking(false);
        scheduleReplyReveal("Chef Bot says", result.reply);
      },
    });
  } catch {
    request.reply = getClientFallbackReply(name, childName);
    saveState();
    renderRequests();
    await speakReply(request.reply, {
      onStart: () => {
        setReplyThinking(false);
        scheduleReplyReveal("Chef Bot dropped the spoon", request.reply);
      },
    });
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
    void submitRequest(button.dataset.suggestion || "");
  });
});

requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  primeSpeech();
  void submitRequest(requestInput.value);
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
  state.requests = [];
  saveState();
  renderRequests();
});

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
renderRequests();
applyProfile(activeProfile);
