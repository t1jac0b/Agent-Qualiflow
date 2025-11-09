import { defineTool } from "./toolTypes.js";

function noop() {
  return { status: "noop" };
}

export const mailTool = defineTool({
  name: "mail",
  description: "Handles mail draft creation and notifications (stub).",
  metadata: { kind: "mail", status: "stub" },
  actions: {
    createDraft: ({ to, subject, body }) => ({ status: "drafted", to, subject, body }),
    queueReminder: noop,
  },
});
