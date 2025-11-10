const form = document.getElementById("capture-form");
const logContainer = document.getElementById("log");
const submitButton = form.querySelector("button[type='submit']");

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function createLogEntry({ title, payload, options }) {
  const wrapper = document.createElement("div");
  wrapper.className = "log-entry";

  const heading = document.createElement("strong");
  heading.textContent = title;
  wrapper.appendChild(heading);

  if (payload !== undefined) {
    const pre = document.createElement("pre");
    pre.textContent = typeof payload === "string" ? payload : formatJson(payload);
    wrapper.appendChild(pre);
  }

  if (Array.isArray(options) && options.length > 0) {
    const optionsContainer = document.createElement("div");
    optionsContainer.className = "options-container";

    options.forEach(({ label, onSelect }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", onSelect);
      optionsContainer.appendChild(button);
    });

    wrapper.appendChild(optionsContainer);
  }

  logContainer.prepend(wrapper);
}

async function sendPositionCapture({ baurundgangId, note, photo }) {
  const formData = new FormData();
  formData.set("baurundgangId", String(baurundgangId));
  formData.set("note", note ?? "");
  formData.set("photo", photo, photo.name || "upload.jpg");

  const response = await fetch("/qs-rundgang/position-erfassen", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload fehlgeschlagen (${response.status}): ${text}`);
  }

  return response.json();
}

async function sendClarification({ contextId, selection }) {
  const response = await fetch("/qs-rundgang/position-clarify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contextId, selection }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Klärung fehlgeschlagen (${response.status}): ${text}`);
  }

  return response.json();
}

function renderClarificationOptions({ contextId, options }) {
  const optionEntries = options.map((label) => ({
    label,
    onSelect: async () => {
      createLogEntry({
        title: "➡️ Auswahl gesendet",
        payload: { contextId, selection: label },
      });

      try {
        const result = await sendClarification({ contextId, selection: label });
        createLogEntry({ title: "✅ Ergebnis", payload: result });
      } catch (error) {
        createLogEntry({ title: "❌ Fehler", payload: error.message });
      }
    },
  }));

  createLogEntry({
    title: "ℹ️ Bitte Auswahl treffen",
    payload: { contextId, options },
    options: optionEntries,
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const baurundgangId = Number(formData.get("baurundgangId")) || 1;
  const note = (formData.get("note") || "").toString().trim();
  const photoFile = form.photo.files[0];

  if (!photoFile) {
    createLogEntry({ title: "❌ Fehler", payload: "Bitte ein Foto auswählen." });
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Senden…";

  createLogEntry({
    title: "📤 Sende Position",
    payload: {
      baurundgangId,
      note,
      photo: photoFile.name,
    },
  });

  try {
    const result = await sendPositionCapture({
      baurundgangId,
      note,
      photo: photoFile,
    });

    createLogEntry({ title: "✅ Antwort", payload: result });

    if (result?.status === "NEEDS_INPUT" && Array.isArray(result.options)) {
      renderClarificationOptions({
        contextId: result.contextId,
        options: result.options,
      });
    }
  } catch (error) {
    createLogEntry({ title: "❌ Fehler", payload: error.message });
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Senden";
    form.reset();
    form.querySelector("input[name='baurundgangId']").value = baurundgangId;
  }
});
