const SESSION_KEY = "feedme-profile";

const analysisLockCard = document.getElementById("analysis-lock-card");
const analysisContent = document.getElementById("analysis-content");
const statTotal = document.getElementById("stat-total");
const statActive = document.getElementById("stat-active");
const statArchived = document.getElementById("stat-archived");
const topFoodsBars = document.getElementById("top-foods-bars");
const childBars = document.getElementById("child-bars");
const dayBars = document.getElementById("day-bars");
const historyBody = document.getElementById("history-body");
const analysisStatus = document.getElementById("analysis-status");
const topFoodsEmpty = document.getElementById("top-foods-empty");
const childBarsEmpty = document.getElementById("child-bars-empty");
const dayBarsEmpty = document.getElementById("day-bars-empty");
const historyEmpty = document.getElementById("history-empty");

function loadProfile() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) {
      return null;
    }

    return JSON.parse(saved);
  } catch {
    return null;
  }
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function toggleEmptyState(element, isEmpty) {
  element.classList.toggle("is-hidden", !isEmpty);
}

function renderBars(container, emptyNode, entries, formatter) {
  container.innerHTML = "";
  const isEmpty = !entries.length;
  toggleEmptyState(emptyNode, isEmpty);

  if (isEmpty) {
    return;
  }

  const maxValue = Math.max(...entries.map((entry) => entry.count), 1);

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "analysis-bar-row";

    const label = document.createElement("div");
    label.className = "analysis-bar-label";
    label.textContent = formatter.label(entry);

    const track = document.createElement("div");
    track.className = "analysis-bar-track";

    const fill = document.createElement("div");
    fill.className = "analysis-bar-fill";
    fill.style.width = `${(entry.count / maxValue) * 100}%`;

    const value = document.createElement("span");
    value.className = "analysis-bar-value";
    value.textContent = formatter.value(entry);

    track.append(fill);
    row.append(label, track, value);
    container.append(row);
  });
}

function renderHistory(requests) {
  historyBody.innerHTML = "";
  const isEmpty = !requests.length;
  toggleEmptyState(historyEmpty, isEmpty);

  if (isEmpty) {
    return;
  }

  requests.forEach((request) => {
    const row = document.createElement("tr");

    const timeCell = document.createElement("td");
    timeCell.textContent = formatDateTime(request.createdAt);

    const childCell = document.createElement("td");
    childCell.textContent = request.childName;

    const foodCell = document.createElement("td");
    foodCell.textContent = request.name;

    const statusCell = document.createElement("td");
    statusCell.textContent = request.status === "archived" ? "Archived" : "Active";

    row.append(timeCell, childCell, foodCell, statusCell);
    historyBody.append(row);
  });
}

async function loadAnalytics() {
  const profile = loadProfile();

  if (!profile || profile.role !== "parent") {
    analysisLockCard.classList.remove("is-hidden");
    analysisContent.classList.add("is-hidden");
    return;
  }

  analysisLockCard.classList.add("is-hidden");
  analysisContent.classList.remove("is-hidden");

  const response = await fetch("/api/analytics/requests");
  if (!response.ok) {
    throw new Error("Analytics request failed");
  }

  const data = await response.json();

  statTotal.textContent = String(data.totals?.total || 0);
  statActive.textContent = String(data.totals?.active || 0);
  statArchived.textContent = String(data.totals?.archived || 0);

  renderBars(topFoodsBars, topFoodsEmpty, data.topFoods || [], {
    label: (entry) => entry.name,
    value: (entry) => `${entry.count}`,
  });

  renderBars(childBars, childBarsEmpty, data.requestsByChild || [], {
    label: (entry) => entry.name,
    value: (entry) => `${entry.count}`,
  });

  renderBars(dayBars, dayBarsEmpty, data.requestsByDay || [], {
    label: (entry) => entry.date,
    value: (entry) => `${entry.count}`,
  });

  renderHistory(data.requests || []);
}

void loadAnalytics().catch(() => {
  analysisStatus.textContent = "Could not load request analytics right now.";
  analysisStatus.classList.remove("is-hidden");
});
