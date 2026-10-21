// Живая проверка без Obsidian: TG_TOKEN=… TG_CHAT=… npx tsx scripts/live-test.ts
import { readFileSync } from "node:fs";
import { convert, extOf } from "../src/convert";
import { HttpFn, InputRichMessage, mimeOf, TelegramClient, TelegramError } from "../src/telegram";

const token = process.env.TG_TOKEN ?? "";
const chat = process.env.TG_CHAT ?? "";
const image = process.env.TG_IMAGE ?? "scripts/test.png";

const http: HttpFn = async (req) => {
	const res = await fetch(req.url, { method: req.method, headers: { "Content-Type": req.contentType }, body: req.body });
	return { status: res.status, text: await res.text() };
};

const note = (version: string) => `---
tags: [тест]
---
# Тестовая заметка (${version})

Обычный текст с **жирным**, *курсивом*, ==выделением== и [[Вики-ссылка|алиасом]]. %%этого не видно%%
Цены: 100$ и $250, формула $E = mc^2$.

> [!tip] Callout
> Цитата с заголовком.

> [!example]- Сворачиваемый
> Скрытый текст с \`кодом $x\`.

| Товар | Цена |
|:------|-----:|
| Чай   | 120$ |

- [ ] задача
- [x] сделано
  - вложенный пункт

$$
\\int_0^1 x^2\\,dx = \\frac13
$$

![[test.png|Тестовая картинка]]

\`\`\`ts
const price = "$5"; // [[не ссылка]]
\`\`\`

#тег`;

async function main(): Promise<void> {
	const client = new TelegramClient(token, http);
	const build = (v: string) => {
		const r = convert(note(v), { resolveLink: (p) => (p === "test.png" ? image : null) });
		const rich: InputRichMessage = { markdown: r.markdown };
		if (r.media.length) rich.media = r.media.map((m) => ({ id: m.id, media: { type: m.kind, media: `attach://${m.id}` } }));
		const files = r.media.map((m) => {
			const data = readFileSync(m.path);
			return { field: m.id, fileName: m.path.split("/").pop()!, mimeType: mimeOf(extOf(m.path)), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
		});
		return { r, rich, files };
	};

	const first = build("v1");
	console.log(first.r.markdown, "\n---", first.r.warnings);
	const msg = await client.sendRichMessage({ chatId: chat }, first.rich, first.files);
	console.log("sent", msg.chat.id, msg.message_id);

	const second = build("v2 — отредактировано");
	await client.editRichMessage(msg.chat.id, msg.message_id, second.rich, second.files);
	console.log("edited");
}

main().catch((e: unknown) => {
	console.error(e instanceof TelegramError ? `TelegramError: ${e.description}` : e);
	process.exit(1);
});
