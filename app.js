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
const childNameInputs = document.querySelectorAll('input[name="childName"]');
const replyOutput = document.getElementById("reply-output");
const replyTitle = document.getElementById("reply-title");
const clientFallbackReplies = [
  "That order just made the frying pan raise an eyebrow.",
  "Interesting choice. The kitchen staff is now in dramatic negotiations.",
  "That meal request has been forwarded to the Department of Snack Affairs.",
  "Bold move. The fridge is pretending it did not hear that.",
  "Strong choice. Someone tell the plates to brace themselves.",
];

let state = loadState();

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
      reply.textContent = request.reply || "Chef Bot is still thinking...";

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

function speakReply(message) {
  if (!("speechSynthesis" in window) || !message) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 1;
  utterance.pitch = 1.15;
  window.speechSynthesis.speak(utterance);
}

function getClientFallbackReply(food, childName) {
  const index = Math.floor(Math.random() * clientFallbackReplies.length);
  return `${childName}, you want ${food}? ${clientFallbackReplies[index]}`;
}

function getSelectedChildName() {
  const selected = Array.from(childNameInputs).find((input) => input.checked);
  return selected ? selected.value : "";
}

async function submitRequest(rawValue) {
  const name = rawValue.trim();
  const childName = getSelectedChildName();

  if (!childName) {
    requestStatus.textContent = "Pick your name before sending a food request.";
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
  const selectedInput = Array.from(childNameInputs).find((input) => input.value === childName);
  if (selectedInput) {
    selectedInput.checked = true;
  }
  requestStatus.textContent = `${childName} asked for ${name}.`;
  updateReplyCard("", "");
  requestInput.focus();

  try {
    const result = await fetchCheekyReply(name);
    request.reply = result.reply;
    saveState();
    renderRequests();
    updateReplyCard("Chef Bot says", result.reply);
    speakReply(result.reply);
  } catch {
    request.reply = getClientFallbackReply(name, childName);
    saveState();
    renderRequests();
    updateReplyCard("Chef Bot dropped the spoon", request.reply);
    speakReply(request.reply);
  }
}

roleTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveView(tab.dataset.viewTarget);
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
    setActiveView(nextTab.dataset.viewTarget);
    nextTab.focus();
  });
});

suggestionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    requestInput.value = button.dataset.suggestion;
    void submitRequest(button.dataset.suggestion || "");
  });
});

requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
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
  setActiveView("kids");
  requestStatus.textContent = "Today's menu is updated.";
});

clearRequestsButton.addEventListener("click", () => {
  state.requests = [];
  saveState();
  renderRequests();
});

updateMealDisplays();
renderRequests();
setActiveView("kids");
