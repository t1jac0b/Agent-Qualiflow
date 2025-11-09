import { getAgentOrchestrator } from "../index.js";
import { formatMissingMessage, formatSuccessMessage } from "../bauBeschrieb/messages.js";

export { formatMissingMessage, formatSuccessMessage } from "../bauBeschrieb/messages.js";

export async function handleBauBeschriebUpload({ buffer, filePath, originalFilename, uploadedBy }) {
  const orchestrator = getAgentOrchestrator();
  const result = await orchestrator.handleTask({
    type: "bauBeschrieb.upload",
    payload: { buffer, filePath, originalFilename, uploadedBy },
  });

  if (result.status === "needs_input") {
    return {
      status: "needs_input",
      message: formatMissingMessage(result),
      context: result,
    };
  }

  if (result.status === "created") {
    return {
      status: "created",
      message: formatSuccessMessage(result),
      context: result,
    };
  }

  return {
    status: "unknown",
    message: "Der Bau-Beschrieb konnte nicht verarbeitet werden.",
    context: result,
  };
}

export async function finalizeBauBeschriebAgent(payload) {
  const orchestrator = getAgentOrchestrator();
  return orchestrator.handleTask({ type: "bauBeschrieb.finalize", payload });
}
