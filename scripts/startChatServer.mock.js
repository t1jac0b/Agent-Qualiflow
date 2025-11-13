process.env.MOCK_CHAT = process.env.MOCK_CHAT ?? "true";

await import("../server/chatServer.js");
