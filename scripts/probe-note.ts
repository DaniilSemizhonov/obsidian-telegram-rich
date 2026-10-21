// Разбор конкретной заметки: TG_TOKEN=… TG_CHAT=… npx tsx scripts/probe-note.ts путь.md
import { readFileSync } from "node:fs";
import { convert } from "../src/convert";
import { HttpFn, TelegramClient } from "../src/telegram";

const http: HttpFn = async (req) => {
	const res = await fetch(req.url, { method: req.method, headers: { "Content-Type": req.contentType }, body: req.body });
	return { status: res.status, text: await res.text() };
};

async function main(): Promise<void> {
	const { markdown } = convert(readFileSync(process.argv[2], "utf8"));
	const client = new TelegramClient(process.env.TG_TOKEN ?? "", http);
	const msg = await client.call<{ message_id: number; rich_message?: unknown }>("sendRichMessage", {
		chat_id: process.env.TG_CHAT,
		rich_message: { markdown },
		disable_notification: true,
	});
	console.log(JSON.stringify(msg.rich_message, null, 1));
}

void main();
