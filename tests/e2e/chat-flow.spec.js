import { test, expect } from "@playwright/test";

async function enableMockChat(page) {
  await page.route("**/chat/message", async (route) => {
    const request = route.request();
    const body = request.postDataJSON?.() ?? {};
    const message = body.message?.trim() ?? "";

    if (!message) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chatId: "chat-e2e",
          status: "info",
          message: "Willkommen! Bitte gib den Projektleiter an (z. B. 'Projektleiter: Max Beispiel').",
          context: {
            pendingRequirements: {
              missingMandatory: ["projektleiter"],
              pendingFields: [{ field: "projektleiter", message: "Bitte Projektleiter angeben." }],
            },
          },
        }),
      });
      return;
    }

    if (/projektleiter\s*[:\-]/i.test(message)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chatId: "chat-e2e",
          status: "created",
          message: "Danke! Projektleiter wurde erfasst.",
          context: {
            projektleiter: {
              name: message.split(/[:\-]/, 2)[1]?.trim() || "Projektleiter",
            },
            pendingRequirements: null,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chatId: "chat-e2e",
        status: "needs_input",
        message: "Ich habe den Projektleiter noch nicht erkannt. Bitte verwende das Format 'Projektleiter: Name'.",
        context: {
          pendingRequirements: {
            missingMandatory: ["projektleiter"],
            pendingFields: [{ field: "projektleiter", message: "Bitte Projektleiter angeben." }],
          },
        },
      }),
    });
  });
}

test.describe("Chat Flow", () => {
  test.beforeEach(async ({ page }) => {
    await enableMockChat(page);
  });

  test("macht fehlende Pflichtangaben sichtbar und akzeptiert Projektleiter", async ({ page }) => {
    await page.goto("/chat.html");

    await expect(page.locator("h1")).toHaveText(/QualiFlow Agent/i);

    await expect(page.locator(".chat-log .chat-message.system")).toContainText(
      /Bitte gib den Projektleiter an/i,
    );

    await page.fill("#chat-message", "Projektleiter: Max Beispiel");
    await page.click("#send-button");

    await expect(page.locator(".chat-log .chat-message.system").last()).toContainText(
      /Danke! Projektleiter wurde erfasst/i,
    );
    await expect(page.locator(".chat-log .chat-message.system").last().locator(".pending-requirements")).toHaveCount(0);
  });
});
