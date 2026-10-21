import { describe, expect, it } from "vitest";
import { buildMultipart, HttpRequest, normalizeChatId, TelegramClient, TelegramError } from "../src/telegram";

const ok = (result: unknown) => ({ status: 200, text: JSON.stringify({ ok: true, result }) });

describe("TelegramClient", () => {
	it("без файлов шлёт JSON и выкидывает undefined", async () => {
		let sent: HttpRequest | undefined;
		const c = new TelegramClient("T", async (r) => ((sent = r), ok({ message_id: 7, chat: { id: 1, type: "private" } })));
		const m = await c.sendRichMessage({ chatId: "12345" }, { markdown: "# Привет" });
		expect(m.message_id).toBe(7);
		expect(sent!.url).toBe("https://api.telegram.org/botT/sendRichMessage");
		expect(JSON.parse(sent!.body as string)).toEqual({ chat_id: 12345, rich_message: { markdown: "# Привет" } });
	});

	it("с файлами шлёт multipart, rich_message — JSON-строкой", async () => {
		let sent: HttpRequest | undefined;
		const c = new TelegramClient("T", async (r) => ((sent = r), ok(true)));
		await c.editRichMessage(
			"@chan",
			5,
			{ markdown: "![](tg://photo?id=m1)", media: [{ id: "m1", media: { type: "photo", media: "attach://m1" } }] },
			[{ field: "m1", fileName: "кот.png", mimeType: "image/png", data: new Uint8Array([1, 2, 3]).buffer }],
		);
		expect(sent!.contentType).toMatch(/^multipart\/form-data; boundary=/);
		const body = new TextDecoder().decode(sent!.body as ArrayBuffer);
		expect(body).toContain('name="chat_id"\r\n\r\n@chan\r\n');
		expect(body).toContain('name="message_id"\r\n\r\n5\r\n');
		expect(body).toContain('"media":"attach://m1"');
		expect(body).toContain('name="m1"; filename="кот.png"\r\nContent-Type: image/png');
	});

	it("ошибка Telegram → TelegramError с description", async () => {
		const c = new TelegramClient("T", async () => ({
			status: 400,
			text: JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message is not modified" }),
		}));
		const err = await c.getMe().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(TelegramError);
		expect((err as TelegramError).description).toBe("Bad Request: message is not modified");
		expect((err as TelegramError).notModified).toBe(true);
	});

	it("без токена — понятная ошибка", async () => {
		const c = new TelegramClient("", async () => ok(true));
		await expect(c.getMe()).rejects.toThrow(/токен/);
	});

	it("находит личные чаты в getUpdates, свежие первыми", async () => {
		const c = new TelegramClient("T", async () =>
			ok([
				{ update_id: 1, message: { message_id: 1, chat: { id: 10, type: "private", first_name: "А" } } },
				{ update_id: 2, message: { message_id: 2, chat: { id: -5, type: "group" } } },
				{ update_id: 3, message: { message_id: 3, chat: { id: 20, type: "private", first_name: "Б" } } },
				{ update_id: 4, message: { message_id: 4, chat: { id: 10, type: "private", first_name: "А" } } },
			]),
		);
		expect((await c.recentPrivateChats()).map((x) => x.id)).toEqual([10, 20]);
	});
});

describe("утилиты", () => {
	it("normalizeChatId", () => {
		expect(normalizeChatId(" 123 ")).toBe(123);
		expect(normalizeChatId("-1001234")).toBe(-1001234);
		expect(normalizeChatId("@name")).toBe("@name");
	});

	it("buildMultipart экранирует имя файла", () => {
		const body = new TextDecoder().decode(
			buildMultipart({}, [{ field: "f", fileName: 'a"b\n.png', mimeType: "image/png", data: new ArrayBuffer(0) }], "B"),
		);
		expect(body).toContain('filename="a_b_.png"');
		expect(body.endsWith("--B--\r\n")).toBe(true);
	});
});
