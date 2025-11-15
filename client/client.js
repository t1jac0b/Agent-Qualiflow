const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-message");
const fileInput = document.getElementById("chat-upload");
const uploadButton = document.getElementById("upload-button");
const sendButton = document.getElementById("send-button");
const resetButton = document.getElementById("reset-chat");
const sessionIdEl = document.getElementById("session-id");
const attachmentsContainer = document.getElementById("chat-attachments");

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

function createOptionButton(option) {
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
  if (status) bits.push(status.toUpperCase());
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

  chatLog.appendChild(wrapper);
  scrollLogToBottom();
}

function setLoading(isLoading) {
  if (isLoading) {
    sendButton.textContent = "Senden…";
  } else {
    sendButton.textContent = "Senden";
  }
  sendButton.disabled = isLoading;
  chatInput.disabled = isLoading;
  uploadButton.disabled = isLoading;
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
  attachmentsContainer.innerHTML = "";

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
    attachmentsContainer.innerHTML = "";
  }
}

chatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawMessage = chatInput?.value ?? "";
  await handleSubmit(rawMessage);
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

  attachmentsContainer.innerHTML = "";
  const chip = document.createElement("span");
  chip.className = "attachment-chip";
  chip.textContent = `${description}: ${file.name}`;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.setAttribute("aria-label", "Datei entfernen");
  removeButton.innerHTML = "&times;";
  removeButton.addEventListener("click", () => {
    state.pendingFile = null;
    attachmentsContainer.innerHTML = "";
  });

  chip.appendChild(removeButton);
  attachmentsContainer.appendChild(chip);
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
