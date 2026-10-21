// Obsidian Markdown → Telegram Rich Markdown.
// Чистый модуль: без обращений к Obsidian API, всё внешнее приходит через options.

export const MAX_LENGTH = 32768;
export const MAX_MEDIA = 50;
export const MAX_TABLE_COLUMNS = 20;

export type MediaKind = "photo" | "video" | "animation" | "audio" | "voice_note" | "document";

export interface MediaRef {
	/** id в ссылке tg://<scheme>?id=… и в rich_message.media */
	id: string;
	/** путь файла в хранилище */
	path: string;
	kind: MediaKind;
}

export interface ConvertOptions {
	/** `==текст==` → `**текст**`; по умолчанию остаётся нативным ==marked== */
	highlightAsBold?: boolean;
	/** Внешние картинки по http(s) встраивать медиа-блоком; иначе — ссылкой */
	embedExternalMedia?: boolean;
	/** Ищет вложение по ссылке из заметки, возвращает путь в хранилище или null */
	resolveLink?: (linkpath: string) => string | null;
	/** Сжимать пустые строки и двойные пробелы; иначе лишние пустые строки сохраняются отступами */
	tidyWhitespace?: boolean;
	/** Одиночный перенос строки — новая строка, как в Obsidian без «строгих переносов» */
	lineBreaks?: boolean;
}

export interface ConvertResult {
	markdown: string;
	media: MediaRef[];
	warnings: string[];
	/** длина в символах Unicode — так считает лимит Telegram */
	length: number;
}

const EXT_KIND: Record<string, MediaKind> = {
	png: "photo", jpg: "photo", jpeg: "photo", webp: "photo", bmp: "photo",
	gif: "animation",
	mp4: "video", mov: "video", webm: "video", mkv: "video", m4v: "video",
	mp3: "audio", m4a: "audio", wav: "audio", flac: "audio", aac: "audio",
	ogg: "voice_note", oga: "voice_note", opus: "voice_note",
};

const LINK_SCHEME: Record<MediaKind, string> = {
	photo: "photo", video: "video", animation: "video",
	audio: "audio", voice_note: "audio", document: "document",
};

const CALLOUT_ICONS: Record<string, string> = {
	note: "📝", abstract: "📋", summary: "📋", tldr: "📋", info: "ℹ️", todo: "☑️",
	tip: "💡", hint: "💡", important: "💡", success: "✅", check: "✅", done: "✅",
	question: "❓", help: "❓", faq: "❓", warning: "⚠️", caution: "⚠️", attention: "⚠️",
	failure: "❌", fail: "❌", missing: "❌", danger: "⛔", error: "⛔", bug: "🐞",
	example: "🧪", quote: "💬", cite: "💬",
};

/** Расширение файла (без точки, в нижнем регистре) */
export function extOf(path: string): string {
	const clean = path.split(/[?#]/)[0];
	const dot = clean.lastIndexOf(".");
	const slash = clean.lastIndexOf("/");
	return dot > slash ? clean.slice(dot + 1).toLowerCase() : "";
}

export function mediaKindOf(path: string): MediaKind {
	return EXT_KIND[extOf(path)] ?? "document";
}

export function stripFrontmatter(src: string): string {
	const m = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(src);
	return m ? src.slice(m[0].length) : src;
}

/** Хранилище защищённых фрагментов: код и формулы заменяются токенами и возвращаются в конце */
class Vault {
	private items: string[] = [];
	put(text: string): string {
		this.items.push(text);
		return `\u0000${this.items.length - 1}\u0000`;
	}
	/** целая строка блока кода/формулы — помечается отдельно, чтобы её не трогали переносы */
	putBlock(text: string): string {
		this.items.push(text);
		return `\u0002${this.items.length - 1}\u0002`;
	}
	restore(text: string): string {
		// фрагменты могут вкладываться (код внутри уже защищённого куска), поэтому до упора
		let prev = "";
		while (prev !== text) {
			prev = text;
			text = text.replace(/[\u0000\u0002](\d+)[\u0000\u0002]/g, (_, i: string) => this.items[Number(i)]);
		}
		return text;
	}
}

const QUOTE_PREFIX = /^[ \t]*(?:>[ \t]?)*/;
const TABLE_DELIM = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

function quoteDepth(prefix: string): number {
	return (prefix.match(/>/g) ?? []).length;
}

/** Срезает с начала строки ровно depth маркеров цитаты; null, если их меньше */
function stripQuotes(line: string, depth: number): { prefix: string; rest: string } | null {
	if (depth === 0) return { prefix: "", rest: line };
	const re = new RegExp(`^((?:[ \\t]*>[ \\t]?){${depth}})`);
	const m = re.exec(line);
	return m ? { prefix: m[1], rest: line.slice(m[1].length) } : null;
}

/**
 * Огороженные блоки кода: содержимое (после префикса цитаты) уходит в токены.
 * dataview/dataviewjs вырезаются, многострочные $$…$$ превращаются в ```math.
 */
function protectFences(lines: string[], vault: Vault): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const prefix = QUOTE_PREFIX.exec(lines[i])![0];
		const rest = lines[i].slice(prefix.length);
		const open = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(rest);
		if (!open || (open[2][0] === "`" && open[3].includes("`"))) {
			out.push(lines[i]);
			continue;
		}
		const depth = quoteDepth(prefix);
		const fence = open[2];
		const lang = open[3].trim().split(/\s+/)[0].toLowerCase();
		const body: string[] = [];
		let j = i + 1;
		let closed = false;
		for (; j < lines.length; j++) {
			const s = stripQuotes(lines[j], depth);
			if (!s) break; // цитата кончилась — блок тоже
			const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(s.rest);
			if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
				closed = true;
				break;
			}
			body.push(lines[j]);
		}
		if (lang === "dataview" || lang === "dataviewjs") {
			i = closed ? j : j - 1;
			continue;
		}
		out.push(prefix + vault.putBlock(rest));
		for (const b of body) {
			const s = stripQuotes(b, depth)!;
			out.push(s.prefix + vault.putBlock(s.rest));
		}
		out.push(prefix + vault.putBlock(open[1] + fence));
		i = closed ? j : j - 1;
	}
	return out;
}

/** Многострочные формулы $$ … $$ в начале строки → ```math (с сохранением префикса цитаты) */
function convertBlockMath(lines: string[], vault: Vault): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const prefix = QUOTE_PREFIX.exec(lines[i])![0];
		const rest = lines[i].slice(prefix.length);
		const open = /^[ \t]*\$\$(.*)$/.exec(rest);
		// однострочная $$…$$ — остаётся как есть, её подхватит protectInlineMath
		if (!open || open[1].includes("$$")) {
			out.push(lines[i]);
			continue;
		}
		const depth = quoteDepth(prefix);
		const body: string[] = open[1].trim() ? [open[1].trim()] : [];
		let j = i + 1;
		let tail = "";
		let closed = false;
		for (; j < lines.length; j++) {
			const s = stripQuotes(lines[j], depth);
			if (!s) break;
			const idx = s.rest.indexOf("$$");
			if (idx >= 0) {
				const before = s.rest.slice(0, idx).trim();
				if (before) body.push(before);
				tail = s.rest.slice(idx + 2).trim();
				closed = true;
				break;
			}
			body.push(s.rest);
		}
		if (!closed) {
			out.push(lines[i]);
			continue;
		}
		out.push(prefix + vault.putBlock("```math"));
		for (const b of body) out.push(prefix + vault.putBlock(b));
		out.push(prefix + vault.putBlock("```"));
		if (tail) out.push(prefix + tail);
		i = j;
	}
	return out;
}

function protectInlineCode(text: string, vault: Vault): string {
	return text.replace(/(`+)(?!`)([^\n]*?[^`\n])\1(?!`)/g, (m) => vault.put(m));
}

function protectInlineMath(text: string, vault: Vault): string {
	text = text.replace(/(?<!\\)\$\$(?!\s)([^$\n]+?)\$\$/g, (m) => vault.put(m));
	// правило Obsidian: после открывающего $ и перед закрывающим нет пробела,
	// за закрывающим нет цифры — поэтому «$100 и $200» формулой не считается
	return text.replace(/(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])*?)(?<![\s\\])\$(?![\d$])/g, (m, body: string) =>
		body.length ? vault.put(m) : m,
	);
}

function escapeDollars(text: string): string {
	return text.replace(/\\\$|\$/g, (m) => (m === "$" ? "\\$" : m));
}

/** Отображаемый текст вики-ссылки: алиас или цель как написана */
function wikiText(inner: string): string {
	const pipe = inner.search(/\\?\|/);
	if (pipe >= 0) {
		const alias = inner.slice(inner.indexOf("|", pipe) + 1).trim();
		if (alias) return alias;
		inner = inner.slice(0, pipe);
	}
	let [target, ...sub] = inner.split("#");
	target = target.replace(/\.md$/i, "").trim();
	const parts = sub.filter((s) => s && !s.startsWith("^")).map((s) => s.trim());
	if (!target) return parts.join(" › ");
	return [target, ...parts].join(" › ");
}

interface PendingMedia {
	/** что показать, если медиа-блок поставить нельзя */
	fallback: string;
	/** путь в хранилище (локальное вложение) */
	path?: string;
	/** внешний URL */
	url?: string;
	caption?: string;
	kind: MediaKind;
}

const isUrl = (s: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(s);

class Converter {
	private vault = new Vault();
	private pending: PendingMedia[] = [];
	private media: MediaRef[] = [];
	private warnings: string[] = [];

	constructor(private opts: ConvertOptions) {}

	run(src: string): ConvertResult {
		let text = stripFrontmatter(src.replace(/\r\n?/g, "\n"));
		let lines = protectFences(text.split("\n"), this.vault);
		text = protectInlineCode(lines.join("\n"), this.vault);
		text = text.replace(/[ \t]*%%[\s\S]*?%%/g, "").replace(/<!--[\s\S]*?-->/g, "");
		lines = convertBlockMath(text.split("\n"), this.vault);
		text = protectInlineMath(lines.join("\n"), this.vault);

		text = this.markEmbeds(text);
		text = text.replace(/(?<!!)\[\[([^\]\n]+?)\]\]/g, (_, inner: string) => wikiText(inner));
		text = escapeDollars(text);
		text = text.replace(/==(?=\S)([^=\n]*?\S)==/g, (m, body: string) =>
			this.opts.highlightAsBold ? `**${body}**` : m,
		);
		// ^block-id в конце абзаца
		text = text.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, "");

		lines = this.placeMedia(text.split("\n"));
		lines = this.callouts(lines);
		lines = stripTrailingTags(lines);
		lines = spacing(lines, this.opts.tidyWhitespace ?? true, this.opts.lineBreaks ?? true);
		this.checkTables(lines);

		const markdown = this.vault.restore(lines.join("\n")).trim();
		const length = [...markdown].length;
		if (length > MAX_LENGTH) {
			this.warnings.push(`Текст длиннее лимита: ${length} из ${MAX_LENGTH} символов`);
		}
		if (this.media.length > MAX_MEDIA) {
			this.warnings.push(`Слишком много медиа: ${this.media.length} из ${MAX_MEDIA}`);
		}
		return { markdown, media: this.media, warnings: this.warnings, length };
	}

	/** ![[…]] и ![…](…) → маркеры \u0001n\u0001, раскладываются по блокам в placeMedia */
	private markEmbeds(text: string): string {
		const mark = (p: PendingMedia): string => {
			this.pending.push(p);
			return `\u0001${this.pending.length - 1}\u0001`;
		};

		text = text.replace(/!\[\[([^\]\n]+?)\]\]/g, (m, inner: string) => {
			const [rawTarget, ...rest] = inner.split(/\\?\|/);
			const target = rawTarget.split("#")[0].trim();
			const alt = rest.join("|").trim();
			const caption = alt && !/^\d+(x\d+)?$/.test(alt) ? alt : undefined;
			const ext = extOf(target);
			if (!ext || ext === "md" || ext === "canvas") {
				this.warnings.push(`Встраивание заметки «${wikiText(inner)}» не поддерживается — вставлено название`);
				return wikiText(inner);
			}
			return mark({ fallback: caption ?? target, path: target, caption, kind: mediaKindOf(target) });
		});

		return text.replace(
			/!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"([^"\n]*)")?\s*\)/g,
			(m, rawAlt: string, rawDest: string, title?: string) => {
				const dest = rawDest.replace(/^<|>$/g, "");
				const alt = rawAlt.split("|")[0].trim();
				const caption = title || (alt && !/^\d+(x\d+)?$/.test(alt) ? alt : undefined);
				if (/^tg:\/\/emoji/i.test(dest)) return m;
				if (/^https?:\/\//i.test(dest)) {
					if (!this.opts.embedExternalMedia) return `[${alt || dest}](${dest})`;
					return mark({ fallback: `[${alt || dest}](${dest})`, url: dest, caption, kind: mediaKindOf(dest) });
				}
				if (isUrl(dest)) return `[${alt || dest}](${dest})`;
				let path = dest;
				try {
					path = decodeURI(dest);
				} catch {
					// оставляем как есть
				}
				return mark({ fallback: alt || path, path, caption, kind: mediaKindOf(path) });
			},
		);
	}

	private registerMedia(p: PendingMedia): string | null {
		const caption = p.caption ? ` "${p.caption.replace(/"/g, "'")}"` : "";
		if (p.url) return `![](${p.url}${caption})`;
		const resolved = this.opts.resolveLink?.(p.path!) ?? null;
		if (!resolved) {
			this.warnings.push(`Файл не найден: ${p.path}`);
			return null;
		}
		let ref = this.media.find((r) => r.path === resolved);
		if (!ref) {
			ref = { id: `m${this.media.length + 1}`, path: resolved, kind: mediaKindOf(resolved) };
			this.media.push(ref);
		}
		return `![](tg://${LINK_SCHEME[ref.kind]}?id=${ref.id}${caption})`;
	}

	/** Медиа в Rich Markdown — только отдельным блоком: разрезаем строку вокруг маркеров */
	private placeMedia(lines: string[]): string[] {
		const out: string[] = [];
		for (const line of lines) {
			if (!line.includes("\u0001")) {
				out.push(line);
				continue;
			}
			const prefix = QUOTE_PREFIX.exec(line)![0];
			const rest = line.slice(prefix.length);
			const blank = prefix.trimEnd();

			if (/^\s*\|/.test(rest)) {
				out.push(line.replace(/\u0001(\d+)\u0001/g, (_, i: string) => {
					const p = this.pending[Number(i)];
					this.warnings.push(`Медиа в ячейке таблицы не поддерживается: ${p.path ?? p.url}`);
					return p.fallback;
				}));
				continue;
			}

			const list = /^(\s*)([-*+]|\d+[.)])(\s+)(\[.\]\s+)?/.exec(rest);
			const indent = list ? " ".repeat(list[0].length) : "";
			const parts = rest.split(/\u0001(\d+)\u0001/);
			let first = true;
			const emit = (s: string): void => {
				if (!first) out.push(blank);
				out.push(prefix + (first ? "" : indent) + s);
				first = false;
			};
			if (list) {
				// маркер списка остаётся в первой строке, даже если текста нет
				parts[0] = parts[0].trimEnd() || list[0].trimEnd();
			}
			for (let k = 0; k < parts.length; k++) {
				if (k % 2 === 0) {
					const t = k === 0 ? parts[k].trimEnd() : parts[k].trim();
					if (t) emit(t);
				} else {
					const p = this.pending[Number(parts[k])];
					const md = this.registerMedia(p);
					emit(md ?? p.fallback);
				}
			}
		}
		return out;
	}

	/** Callout'ы и цитаты, рекурсивно для вложенных */
	private callouts(lines: string[]): string[] {
		const out: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			const m = /^([ \t]*)>/.exec(lines[i]);
			if (!m) {
				out.push(lines[i]);
				continue;
			}
			const indent = m[1];
			const inner: string[] = [];
			let j = i;
			for (; j < lines.length; j++) {
				const q = /^([ \t]*)>[ \t]?(.*)$/.exec(lines[j]);
				if (!q || q[1] !== indent) break;
				inner.push(q[2]);
			}
			i = j - 1;
			out.push(...this.quoteBlock(inner).map((l) => indent + l));
		}
		return out;
	}

	private quoteBlock(inner: string[]): string[] {
		const head = /^\[!([^\]\s]+)\]([+-]?)[ \t]*(.*)$/.exec(inner[0] ?? "");
		if (!head) {
			return this.callouts(inner).map((l) => (l ? `> ${l}` : ">"));
		}
		const type = head[1].toLowerCase();
		const fold = head[2];
		const title = head[3].trim() || type.charAt(0).toUpperCase() + type.slice(1);
		const icon = CALLOUT_ICONS[type];
		const heading = `**${icon ? icon + " " : ""}${title}**`;
		const body = this.callouts(inner.slice(1));
		while (body.length && !body[body.length - 1].trim()) body.pop();

		if (fold) {
			return [`<details${fold === "+" ? " open" : ""}><summary>${heading}</summary>`, "", ...body, "", "</details>"];
		}
		const quoted = [heading, ...(body.length ? [""] : []), ...body];
		return quoted.map((l) => (l ? `> ${l}` : ">"));
	}

	private checkTables(lines: string[]): void {
		for (const line of lines) {
			const rest = line.slice(QUOTE_PREFIX.exec(line)![0].length).trim();
			if (!TABLE_DELIM.test(rest)) continue;
			const cols = rest.replace(/^\||\|$/g, "").split("|").length;
			if (cols > MAX_TABLE_COLUMNS) {
				this.warnings.push(`В таблице ${cols} колонок, Telegram принимает до ${MAX_TABLE_COLUMNS}`);
			}
		}
	}
}

const restOf = (line: string): string => line.slice(QUOTE_PREFIX.exec(line)![0].length);
const isBlank = (line: string): boolean => !restOf(line).trim();

/** Строка — самостоятельный блок, к которому перенос не относится */
function isBlockLine(rest: string): boolean {
	return (
		rest.includes("\u0002") ||
		/^\s*(#{1,6}\s|\||<|!\[\]\(|\[\^[^\]]+\]:)/.test(rest) ||
		/^\s*([-*_])(\s*\1){2,}\s*$/.test(rest) ||
		/^\s*=+\s*$/.test(rest)
	);
}

/** Пустые строки, пробелы и одиночные переносы */
function spacing(lines: string[], tidy: boolean, breaks: boolean): string[] {
	// хвостовые пробелы: два и больше — явный перенос Markdown, их оставляем ровно два
	lines = lines.map((l) => {
		if (l.includes("\u0002") || isBlank(l)) return isBlank(l) ? l.trimEnd() : l;
		const prefix = QUOTE_PREFIX.exec(l)![0];
		let rest = l.slice(prefix.length);
		const hard = / {2,}$/.test(rest);
		rest = rest.trimEnd();
		if (tidy) rest = rest.replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ");
		return prefix + rest + (hard ? "  " : "");
	});

	const out: string[] = [];
	for (let i = 0; i < lines.length; ) {
		if (!isBlank(lines[i])) {
			out.push(lines[i++]);
			continue;
		}
		let j = i;
		while (j < lines.length && isBlank(lines[j])) j++;
		if (out.length && j < lines.length) {
			const blank = lines[i];
			out.push(blank);
			if (!tidy) {
				// каждая лишняя пустая строка — пустой абзац, иначе Markdown их схлопнет
				for (let k = i + 1; k < j; k++) out.push(blank ? `${blank} &nbsp;` : "&nbsp;", blank);
			}
		}
		i = j;
	}

	// Telegram затягивает заголовок или таблицу сразу после пункта списка внутрь пункта,
	// поэтому перед ними всегда пустая строка
	for (let i = 1; i < out.length; i++) {
		const rest = restOf(out[i]);
		if (rest.includes("\u0002") || isBlank(out[i - 1])) continue;
		const heading = /^ {0,3}#{1,6}\s/.test(rest);
		const table = /^\s*\|/.test(rest) && !/^\s*\|/.test(restOf(out[i - 1])) && TABLE_DELIM.test(restOf(out[i + 1] ?? "").trim());
		if (heading || table) {
			out.splice(i, 0, QUOTE_PREFIX.exec(out[i])![0].trimEnd());
			i++;
		}
	}

	if (breaks) {
		for (let i = 0; i + 1 < out.length; i++) {
			const cur = out[i];
			const next = out[i + 1];
			if (isBlank(cur) || isBlank(next) || cur.endsWith("  ")) continue;
			if (quoteDepth(QUOTE_PREFIX.exec(cur)![0]) !== quoteDepth(QUOTE_PREFIX.exec(next)![0])) continue;
			if (isBlockLine(restOf(cur)) || isBlockLine(restOf(next))) continue;
			if (/^\s*([-*+]|\d+[.)])\s/.test(restOf(next))) continue;
			out[i] = cur + "  ";
		}
	}
	return out;
}

/** Строки, состоящие только из #тегов, в конце заметки */
function stripTrailingTags(lines: string[]): string[] {
	const tagLine = /^\s*(#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*[ \t,]*)+$/u;
	let end = lines.length;
	while (end > 0 && (!lines[end - 1].trim() || tagLine.test(lines[end - 1]))) end--;
	return lines.slice(0, end);
}

export function convert(src: string, opts: ConvertOptions = {}): ConvertResult {
	return new Converter({ embedExternalMedia: true, ...opts }).run(src);
}
