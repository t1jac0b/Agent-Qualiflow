const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-message");
const fileInput = document.getElementById("chat-upload");
const uploadButton = document.getElementById("upload-button");
const micButton = document.getElementById("mic-button");
const sendButton = document.getElementById("send-button");
const resetButton = document.getElementById("reset-chat");
const sessionIdEl = document.getElementById("session-id");
const attachmentsContainer = document.getElementById("chat-attachments");
const agentStatusEl = document.getElementById("agent-status");

const STORAGE_KEY = "qualicasa-chat-session-id";

const state = {
  chatId: window.sessionStorage.getItem(STORAGE_KEY) || null,
  pendingCapture: null,
  pendingFile: null,
};

function formatTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function updateSessionDisplay() {
  if (!sessionIdEl) return;
  sessionIdEl.textContent = state.chatId ?? "–";
}

function setChatId(id) {
  if (!id) return;
  state.chatId = id;
  window.sessionStorage.setItem(STORAGE_KEY, id);
  updateSessionDisplay();
}

function clearChatId() {
  state.chatId = null;
  window.sessionStorage.removeItem(STORAGE_KEY);
  updateSessionDisplay();
}

function scrollLogToBottom() {
  if (!chatLog) return;
  chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
}

function optionLabel(option) {
  if (option == null) return "–";
  if (typeof option === "string") return option;
  if (typeof option === "number") return String(option);
  if (option.label) return option.label;
  if (option.name) return option.name;
  if (option.bezeichnung) return option.bezeichnung;
  if (option.title) return option.title;
  if (option.value) return String(option.value);
  if (option.id) return String(option.id);
  try {
    return JSON.stringify(option);
  } catch (error) {
    console.error("optionLabel failed", { option, error });
    return String(option);
  }
}

function optionValue(option) {
  if (option == null) return "";
  if (typeof option === "string" || typeof option === "number") {
    return String(option);
  }
  return option.inputValue ?? optionLabel(option);
}

function renderSelectionSummary(selection) {
  if (!selection) return null;

  const items = [];
  if (selection.kunde) {
    const kundeLabel = selection.kunde.name ?? selection.kunde.id ?? "unbekannt";
    items.push(`Kunde: ${kundeLabel}`);
  }
  if (selection.objekt) {
    const objektLabel = selection.objekt.bezeichnung ?? selection.objekt.id ?? "unbekannt";
    items.push(`Objekt: ${objektLabel}`);
  }
  if (selection.baurundgang) {
    const datum = selection.baurundgang.datumDurchgefuehrt ?? selection.baurundgang.datumGeplant;
    const formattedDate = datum ? new Date(datum).toISOString().slice(0, 10) : null;
    const typName = selection.baurundgang.typ?.name ?? selection.baurundgang.label ?? selection.baurundgang.id;
    items.push(`Baurundgang: ${formattedDate ? `${typName} – ${formattedDate}` : typName}`);
  }
  if (selection.pruefpunkteGewuenscht !== undefined) {
    items.push(`Prüfpunkte: ${selection.pruefpunkteGewuenscht ? "erfassen" : "überspringen"}`);
  }

  if (!items.length) return null;

  const paragraph = document.createElement("p");
  paragraph.className = "meta";
  paragraph.textContent = items.join(" • ");
  return paragraph;
}

function formatStatusDisplay(status, role) {
  if (!status) return null;
  const normalized = String(status).toLowerCase();

  if (role === "user") {
    if (normalized === "gesendet") return "Gesendet";
    return status;
  }

  const map = {
    awaiting_customer: "Kundenauswahl",
    awaiting_object: "Objektauswahl",
    awaiting_baurundgang: "Baurundgang wählen",
    setup_complete: "Setup abgeschlossen",
    capture_success: "Position erfasst",
    capture_cancelled: "Erfassung abgebrochen",
    pruefpunkte_cancelled: "Prüfpunkte-Erfassung beendet",
    no_customers: "Keine Kunden vorhanden",
    no_objects: "Keine Objekte gefunden",
    no_baurundgaenge: "Keine Baurundgänge gefunden",
    missing_setup: "Kontext unvollständig",
  };

  const label = map[normalized];
  if (!label) {
    return null;
  }
  return label;
}

function renderAgentSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return null;

  const details = document.createElement("details");
  details.className = "agent-steps";

  const summary = document.createElement("summary");
  summary.textContent = "Schritte des Agents anzeigen";
  details.appendChild(summary);

  const list = document.createElement("ul");

  steps.forEach((step, index) => {
    if (!step) return;
    const li = document.createElement("li");
    const parts = [];

    if (step.type === "tool" && step.name) {
      parts.push(`Tool: ${step.name}`);
      if (Array.isArray(step.argsKeys) && step.argsKeys.length) {
        parts.push(`Argumente: ${step.argsKeys.join(", ")}`);
      }
    } else if (step.type === "reply") {
      parts.push("Antwort finalisiert");
      if (step.status) {
        parts.push(`Status: ${step.status}`);
      }
    } else if (step.type === "agent" && step.name) {
      parts.push(step.name);
      if (step.summary) {
        parts.push(step.summary);
      } else if (step.status) {
        parts.push(`Status: ${step.status}`);
      }
    } else if (step.summary) {
      parts.push(step.summary);
    }

    li.textContent = parts.filter(Boolean).join(" – ") || `Schritt ${index + 1}`;
    list.appendChild(li);
  });

  details.appendChild(list);
  return details;
}

function createOptionButton(option) {
  const rawValue = option?.inputValue ?? optionLabel(option) ?? "";
  const trimmedValue = typeof rawValue === "string" ? rawValue.trim() : String(rawValue);
  const looksLikeUrl = /^https?:\/\//i.test(trimmedValue);
  if (option?.isLink || looksLikeUrl) {
    const link = document.createElement("a");
    link.className = "option-button option-link";
    link.textContent = optionLabel(option);
    link.href = trimmedValue || optionLabel(option);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "option-button";
  button.textContent = optionLabel(option);
  button.addEventListener("click", () => {
    if (sendButton.disabled || chatInput.disabled) {
      return;
    }
    chatInput.value = optionValue(option);
    chatInput.focus();
    void handleSubmit(chatInput.value);
  });
  return button;
}

function appendMessage({ role, text, status, options, context }) {
  if (!chatLog) return;

  const wrapper = document.createElement("article");
  wrapper.className = `chat-message ${role}`;

  const heading = document.createElement("h3");
  heading.textContent = role === "user" ? "Du" : "Agent";
  wrapper.appendChild(heading);

  const meta = document.createElement("div");
  meta.className = "meta";
  const bits = [];
  const friendlyStatus = formatStatusDisplay(status, role);
  if (friendlyStatus) bits.push(friendlyStatus);
  bits.push(formatTimestamp());
  meta.textContent = bits.join(" • ");
  wrapper.appendChild(meta);

  const messageText = text && text.trim() ? text : "(keine Nachricht)";
  messageText.split(/\n+/).forEach((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    wrapper.appendChild(paragraph);
  });

  const resolvedOptions = Array.isArray(options)
    ? options
    : Array.isArray(context?.options)
    ? context.options
    : null;

  if (resolvedOptions && resolvedOptions.length) {
    const optionContainer = document.createElement("div");
    optionContainer.className = "option-list";
    resolvedOptions.forEach((option) => {
      optionContainer.appendChild(createOptionButton(option));
    });
    wrapper.appendChild(optionContainer);
  }

  const selectionSummary = context?.selection ? renderSelectionSummary(context.selection) : null;
  if (selectionSummary) {
    wrapper.appendChild(selectionSummary);
  }

  const pendingRequirements = context?.pendingRequirements;
  if (pendingRequirements && (pendingRequirements.missingMandatory?.length || pendingRequirements.pendingFields?.length)) {
    const requirementBox = document.createElement("div");
    requirementBox.className = "pending-requirements";

    const title = document.createElement("h4");
    title.textContent = "Fehlende Pflichtangaben";
    requirementBox.appendChild(title);

    const list = document.createElement("ul");
    const items = new Set([
      ...(pendingRequirements.missingMandatory ?? []),
      ...(pendingRequirements.pendingFields ?? []).map((item) => item.field ?? item),
    ]);
    Array.from(items)
      .filter(Boolean)
      .forEach((field) => {
        const li = document.createElement("li");
        li.textContent = field;
        list.appendChild(li);
      });
    requirementBox.appendChild(list);
    wrapper.appendChild(requirementBox);

    if (pendingRequirements.missingMandatory?.includes("projektleiter")) {
      const hint = document.createElement("p");
      hint.className = "meta";
      hint.textContent = "Tipp: Projektleiterdaten als 'Projektleiter: Name', 'Projektleiter E-Mail: …', 'Projektleiter Telefon: …' angeben.";
      requirementBox.appendChild(hint);
    }
  }

  if (context?.attachment) {
    const uploadHint = document.createElement("p");
    uploadHint.className = "meta";
    uploadHint.textContent = `Upload gespeichert: ${context.attachment.name ?? context.attachment.id}`;
    wrapper.appendChild(uploadHint);
  }

  const stepsElement = context?.steps ? renderAgentSteps(context.steps) : null;
  if (stepsElement) {
    wrapper.appendChild(stepsElement);
  }

  chatLog.appendChild(wrapper);
  scrollLogToBottom();
}

function setLoading(isLoading) {
  if (agentStatusEl) {
    agentStatusEl.textContent = isLoading ? "Arbeitet…" : "Bereit";
  }
  if (sendButton) {
    if (isLoading) {
      sendButton.textContent = "Senden…";
    } else {
      sendButton.textContent = "Senden";
    }
    sendButton.disabled = isLoading;
  }
  if (chatInput) {
    chatInput.disabled = isLoading;
  }
  if (uploadButton) {
    uploadButton.disabled = isLoading;
  }
  if (micButton) {
    micButton.disabled = isLoading;
  }
  const optionButtons = chatLog?.querySelectorAll(".option-button");
  optionButtons?.forEach((button) => {
    button.disabled = isLoading;
  });
}

async function postChatMessage(body) {
  const payload = { ...body };
  if (state.chatId && !payload.chatId) {
    payload.chatId = state.chatId;
  }

  const response = await fetch("/chat/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
}

async function sendChatMessage({ message, options = {}, attachment }) {
  const payload = { message };

  if (options?.capture) {
    payload.context = { ...options.capture };
  }

  if (attachment) {
    payload.attachmentId = attachment.id;
  }

  return postChatMessage(payload);
}

async function uploadPendingFile() {
  if (!state.pendingFile) return null;

  const { file } = state.pendingFile;
  const formData = new FormData();
  if (state.chatId) {
    formData.append("chatId", state.chatId);
  }
  formData.append("file", file);

  const response = await fetch("/chat/upload", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const result = await response.json();
  if (result.chatId) {
    setChatId(result.chatId);
  }

  state.pendingFile = null;
  if (attachmentsContainer) {
    attachmentsContainer.innerHTML = "";
  }

  return result;
}

async function handleSubmit(message) {
  const trimmed = message.trim();
  if (!trimmed && !state.pendingFile) {
    return;
  }

  const userLines = [];
  if (state.pendingFile) {
    const description = state.pendingFile.description;
    userLines.push(`${description}: ${state.pendingFile.file.name}`);
  }
  if (trimmed) {
    userLines.push(trimmed);
  }

  appendMessage({ role: "user", text: userLines.join("\n"), status: "gesendet" });
  setLoading(true);

  try {
    let uploadResult = null;
    if (state.pendingFile) {
      uploadResult = await uploadPendingFile();
      if (uploadResult?.message) {
        appendMessage({
          role: "system",
          text: uploadResult.message,
          status: uploadResult.status ?? "upload",
          options: uploadResult.options,
          context: uploadResult.context,
        });
      }
    }

    const result = await sendChatMessage({
      message: trimmed,
      options: state.pendingCapture,
      attachment: uploadResult?.context?.attachment,
    });
    if (result.chatId) {
      setChatId(result.chatId);
    }
    appendMessage({
      role: "system",
      text: result.message ?? "",
      status: result.status ?? "info",
      options: result.options,
      context: result.context,
    });
  } catch (error) {
    console.error("Chat send failed", error);
    appendMessage({ role: "system", text: `Fehler: ${error.message}`, status: "error" });
  } finally {
    setLoading(false);
    chatForm.reset();
    chatInput?.focus();
    state.pendingFile = null;
    if (attachmentsContainer) {
      attachmentsContainer.innerHTML = "";
    }
  }
}

chatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawMessage = chatInput?.value ?? "";
  await handleSubmit(rawMessage);
});

micButton?.addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("SpeechRecognition API nicht verfügbar");
    return;
  }

  try {
    const recognition = new SpeechRecognition();
    recognition.lang = "de-CH";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    if (micButton) {
      micButton.disabled = true;
    }

    recognition.addEventListener("result", (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript && chatInput) {
        chatInput.value = transcript;
        chatInput.focus();
      }
    });

    recognition.addEventListener("error", (event) => {
      console.error("Speech recognition error", event.error ?? event);
    });

    recognition.addEventListener("end", () => {
      if (micButton) {
        micButton.disabled = false;
      }
    });

    recognition.start();
  } catch (error) {
    console.error("Speech recognition init failed", error);
    if (micButton) {
      micButton.disabled = false;
    }
  }
});

uploadButton?.addEventListener("click", () => {
  fileInput?.click();
});

fileInput?.addEventListener("change", async (event) => {
  const file = event.target?.files?.[0];
  if (!file) {
    return;
  }

  const description = file.type?.includes("pdf") ? "Dokument" : "Datei";
  state.pendingFile = { file, description };
  fileInput.value = "";

  if (attachmentsContainer) {
    attachmentsContainer.innerHTML = "";
  }
  const chip = document.createElement("span");
  chip.className = "attachment-chip";
  chip.textContent = `${description}: ${file.name}`;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.setAttribute("aria-label", "Datei entfernen");
  removeButton.innerHTML = "&times;";
  removeButton.addEventListener("click", () => {
    state.pendingFile = null;
    if (attachmentsContainer) {
      attachmentsContainer.innerHTML = "";
    }
  });

  chip.appendChild(removeButton);
  if (attachmentsContainer) {
    attachmentsContainer.appendChild(chip);
  }
});

resetButton?.addEventListener("click", () => {
  clearChatId();
  if (chatLog) {
    chatLog.innerHTML = "";
  }
  state.pendingCapture = null;
  initializeConversation();
});

async function initializeConversation() {
  try {
    setLoading(true);
    const result = await postChatMessage({ message: "" });
    if (result.chatId) {
      setChatId(result.chatId);
    }
    if (result.message || result.context || result.options) {
      appendMessage({
        role: "system",
        text: result.message ?? "",
        status: result.status ?? "info",
        options: result.options,
        context: result.context,
      });
    }
  } catch (error) {
    console.error("Konversationsstart fehlgeschlagen", error);
    appendMessage({ role: "system", text: `Fehler: ${error.message}`, status: "error" });
  } finally {
    setLoading(false);
    chatInput?.focus();
  }
}

function bootstrap() {
  updateSessionDisplay();

  initializeConversation();
}

bootstrap();
