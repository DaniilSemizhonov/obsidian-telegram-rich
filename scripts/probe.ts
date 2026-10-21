// Зонд разметки: отправляет варианты и печатает, как Telegram разобрал их на блоки.
// TG_TOKEN=… TG_CHAT=… npx tsx scripts/probe.ts [номер варианта]
import { HttpFn, TelegramClient, TelegramError } from "../src/telegram";

const http: HttpFn = async (req) => {
	const res = await fetch(req.url, { method: req.method, headers: { "Content-Type": req.contentType }, body: req.body });
	return { status: res.status, text: await res.text() };
};

const LIST = "- Первый пункт.\n- Второй пункт.\n- Третий пункт.";
const AFTER = "Плашка внизу: этот абзац должен идти после списка, а не внутри него.";
const P1 = "Заголовок: Инвариант в задании 12";
const P2 = "Первый блок текста:  \nИнвариантом называют свойство, которое не меняется, пока работает алгоритм. Головка ездит по ленте, символы переписываются, а какая-то величина остаётся прежней.";
const P3 = "Второй блок текста:  \nВ №12 на ленте бывает 1000 символов и больше, перебрать все варианты не получится.";

const variants: [string, string][] = [
	["1. Список → пустая строка → абзац (как сейчас)", `${LIST}\n\n${AFTER}`],
	["2. Список → две пустые строки → абзац", `${LIST}\n\n\n${AFTER}`],
	["3. Список → <!-- --> → абзац", `${LIST}\n\n<!-- -->\n\n${AFTER}`],
	["4. Список → &nbsp; → абзац", `${LIST}\n\n&nbsp;\n\n${AFTER}`],
	["5. Список → <p>абзац</p>", `${LIST}\n\n<p>${AFTER}</p>`],
	["6. Абзацы через пустую строку (как сейчас)", `${P1}\n\n${P2}\n\n${P3}`],
	["7. Абзацы, между ними пустой абзац &nbsp;", `${P1}\n\n&nbsp;\n\n${P2}\n\n&nbsp;\n\n${P3}`],
	["8. Абзацы, между ними <br>", `${P1}\n\n<br>\n\n${P2}\n\n<br>\n\n${P3}`],
	["9. Одиночный перенос через обратный слеш", P2.replace("  \n", "\\\n")],
];

type Node = { type?: string; text?: unknown; items?: { label?: string; blocks?: Node[] }[]; blocks?: Node[] };

function plain(t: unknown): string {
	if (typeof t === "string") return t;
	if (Array.isArray(t)) return t.map(plain).join("");
	if (t && typeof t === "object" && "text" in t) return plain((t as { text: unknown }).text);
	return "";
}

function dump(blocks: Node[], depth = 0): void {
	const pad = "  ".repeat(depth);
	for (const b of blocks) {
		const text = plain(b.text).replace(/\n/g, "⏎");
		console.log(`${pad}${b.type}${text ? `: ${text.slice(0, 70)}` : ""}`);
		if (b.items) {
			for (const it of b.items) {
				console.log(`${pad}  • item ${it.label ?? ""}`);
				dump(it.blocks ?? [], depth + 2);
			}
		}
		if (b.blocks) dump(b.blocks, depth + 1);
	}
}

async function main(): Promise<void> {
	const client = new TelegramClient(process.env.TG_TOKEN ?? "", http);
	const only = process.argv[2] ? Number(process.argv[2]) : null;
	for (const [i, [title, markdown]] of variants.entries()) {
		if (only && only !== i + 1) continue;
		console.log(`\n=== ${title}`);
		try {
			const msg = await client.call<{ message_id: number; rich_message?: { blocks: Node[] } }>("sendRichMessage", {
				chat_id: process.env.TG_CHAT,
				rich_message: { markdown: `**${title}**\n\n${markdown}` },
				disable_notification: true,
			});
			dump(msg.rich_message?.blocks ?? []);
		} catch (e) {
			console.log("ОШИБКА:", e instanceof TelegramError ? e.description : e);
		}
	}
}

void main();
