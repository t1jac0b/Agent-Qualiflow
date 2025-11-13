const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-message");
const fileInput = document.getElementById("chat-upload");
const sendButton = document.getElementById("send-button");
const resetButton = document.getElementById("reset-chat");
const sessionIdEl = document.getElementById("session-id");

const STORAGE_KEY = "qualicasa-chat-session-id";

const state = {
  chatId: window.sessionStorage.getItem(STORAGE_KEY) || null,
  pendingCapture: null,
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
    chatInput.value = optionValue(option);
    chatInput.focus();
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

async function sendChatMessage({ message, options = {} }) {
  const payload = { message };

  if (options?.capture) {
    payload.context = { ...options.capture };
  }

  return postChatMessage(payload);
}

async function handleSubmit(message) {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }

  appendMessage({ role: "user", text: trimmed, status: "gesendet" });
  setLoading(true);

  try {
    const result = await sendChatMessage({ message: trimmed, options: state.pendingCapture });
    if (result.chatId) {
      setChatId(result.chatId);
    }
    appendMessage({
      role: "system",
      text: result.message ?? "(keine Antwort)",
      status: result.status ?? "info",
      options: result.options,
      context: result.context,
    });
    state.pendingCapture = null;
  } catch (error) {
    console.error("Chat send failed", error);
    appendMessage({ role: "system", text: `Fehler: ${error.message}`, status: "error" });
  } finally {
    setLoading(false);
    chatForm.reset();
    chatInput?.focus();
  }
}

chatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawMessage = chatInput?.value ?? "";
  await handleSubmit(rawMessage);
});

fileInput?.addEventListener("change", async (event) => {
  const file = event.target?.files?.[0];
  if (!file) {
    return;
  }

  appendMessage({ role: "user", text: `Foto ausgewählt: ${file.name}`, status: "upload" });

  const formData = new FormData();
  if (state.chatId) {
    formData.append("chatId", state.chatId);
  }
  formData.append("file", file);

  try {
    setLoading(true);
    const response = await fetch("/chat/upload", { method: "POST", body: formData });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const result = await response.json();
    if (result.chatId) {
      setChatId(result.chatId);
    }
    if (result.message) {
      appendMessage({ role: "system", text: result.message, status: result.status ?? "upload" });
    }
    if (result.context?.captureTrigger) {
      state.pendingCapture = {
        attachment: {
          fileName: file.name,
          url: result.context.captureTrigger.url,
          mimeType: file.type,
        },
      };
    }
  } catch (error) {
    console.error("Upload failed", error);
    appendMessage({ role: "system", text: `Upload fehlgeschlagen: ${error.message}`, status: "error" });
  } finally {
    setLoading(false);
    fileInput.value = "";
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
