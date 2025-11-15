import { test, expect } from "@playwright/test";

async function mockReportDownloadFlow(page) {
  const downloadUrl = "/storage/reports/qs/mock-report.pdf";
  await page.route("**/chat/message", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON?.() ?? {};
    const message = payload.message?.trim()?.toLowerCase() ?? "";

    if (!message || message === "start") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chatId: "chat-report",
          status: "SUCCESS",
          message: "Der QS-Report für den Baurundgang ist bereit. Sie können den Bericht jetzt herunterladen oder weiter bearbeiten.",
          context: {
            options: [
              { id: "view-report", label: "Report ansehen", inputValue: downloadUrl, isLink: true },
              { id: "capture", label: "Neue Position erfassen", inputValue: "Neue Position erfassen" },
            ],
          },
        }),
      });
      return;
    }

    if (message.includes("bericht")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chatId: "chat-report",
          status: "SUCCESS",
          message: `Der Bericht ist jetzt bereit zum Herunterladen. Link: ${downloadUrl}`,
          context: {
            options: [
              { id: "view-report", label: "Report erneut ansehen", inputValue: downloadUrl, isLink: true },
            ],
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chatId: "chat-report",
        status: "SUCCESS",
        message: "Danke für die Rückmeldung.",
      }),
    });
  });
}

test.describe("Report download link", () => {
  test.beforeEach(async ({ page }) => {
    await mockReportDownloadFlow(page);
  });

  test("zeigt einen funktionierenden Download-Link für den QS-Report", async ({ page }) => {
    await page.goto("/chat.html");

    await page.fill("#chat-message", "start");
    await page.click("#send-button");

    const sysMessages = page.locator(".chat-log .chat-message.system");
    await expect(sysMessages.last()).toContainText("Der QS-Report für den Baurundgang ist bereit");

    const link = page.locator(".chat-log .chat-message.system .option-list a.option-link").first();
    await expect(link).toHaveText("Report ansehen");
    await expect(link).toHaveAttribute("href", "/storage/reports/qs/mock-report.pdf");

    await page.fill("#chat-message", "Bericht herunterladen");
    await page.click("#send-button");

    await expect(sysMessages.last()).toContainText("Der Bericht ist jetzt bereit zum Herunterladen");
    const followUpLink = page.locator(".chat-log .chat-message.system .option-list a.option-link").last();
    await expect(followUpLink).toHaveAttribute("href", "/storage/reports/qs/mock-report.pdf");
  });
});
