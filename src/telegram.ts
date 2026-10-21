// Клиент Bot API. HTTP-функция внедряется снаружи (в плагине — requestUrl), чтобы не было CORS
// и чтобы клиент можно было тестировать без Obsidian.

import type { MediaKind } from "./convert";

export interface HttpRequest {
	url: string;
	method: "POST";
	contentType: string;
	body: string | ArrayBuffer;
}

export interface HttpResponse {
	status: number;
	text: string;
}

export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

export interface UploadFile {
	/** имя поля multipart = id из attach:// */
	field: string;
	fileName: string;
	mimeType: string;
	data: ArrayBuffer;
}

export interface InputRichMessage {
	markdown: string;
	media?: { id: string; media: { type: MediaKind; media: string } }[];
	skip_entity_detection?: boolean;
}

export interface Chat {
	id: number;
	type: string;
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
}

export interface Message {
	message_id: number;
	chat: Chat;
}

export interface User {
	id: number;
	username?: string;
	first_name: string;
}

interface Update {
	update_id: number;
	message?: Message;
}

interface ApiResponse<T> {
	ok: boolean;
	result?: T;
	description?: string;
	error_code?: number;
}

export class TelegramError extends Error {
	constructor(
		readonly description: string,
		readonly code?: number,
	) {
		super(description);
		this.name = "TelegramError";
	}

	get notModified(): boolean {
		return /message is not modified/i.test(this.description);
	}

	get messageGone(): boolean {
		return /message to edit not found|message can't be edited|MESSAGE_ID_INVALID/i.test(this.description);
	}
}

export type Params = Record<string, unknown>;

export interface Target {
	chatId: string | number;
	threadId?: number;
}

const MIME: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp", gif: "image/gif",
	mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", m4v: "video/mp4",
	mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac",
	ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", pdf: "application/pdf", zip: "application/zip",
};

export function mimeOf(ext: string): string {
	return MIME[ext] ?? "application/octet-stream";
}

/** "@channel", "123", "-100…" → значение для chat_id */
export function normalizeChatId(raw: string | number): string | number {
	const s = String(raw).trim();
	return /^-?\d+$/.test(s) ? Number(s) : s;
}

export function buildMultipart(params: Params, files: UploadFile[], boundary: string): ArrayBuffer {
	const enc = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const quote = (s: string): string => s.replace(/["\r\n]/g, "_");

	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		const v = typeof value === "string" ? value : JSON.stringify(value);
		chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${v}\r\n`));
	}
	for (const f of files) {
		chunks.push(
			enc.encode(
				`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${quote(f.fileName)}"\r\n` +
					`Content-Type: ${f.mimeType}\r\n\r\n`,
			),
			new Uint8Array(f.data),
			enc.encode("\r\n"),
		);
	}
	chunks.push(enc.encode(`--${boundary}--\r\n`));

	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let pos = 0;
	for (const c of chunks) {
		out.set(c, pos);
		pos += c.length;
	}
	return out.buffer;
}

export class TelegramClient {
	constructor(
		private token: string,
		private http: HttpFn,
	) {}

	async call<T>(method: string, params: Params, files: UploadFile[] = []): Promise<T> {
		if (!this.token) throw new TelegramError("Не задан токен бота — укажите его в настройках плагина");
		const url = `https://api.telegram.org/bot${this.token}/${method}`;
		let req: HttpRequest;
		if (files.length) {
			const boundary = "----obsidian-tg-" + Math.random().toString(36).slice(2);
			req = { url, method: "POST", contentType: `multipart/form-data; boundary=${boundary}`, body: buildMultipart(params, files, boundary) };
		} else {
			const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
			req = { url, method: "POST", contentType: "application/json", body: JSON.stringify(clean) };
		}

		let res: HttpResponse;
		try {
			res = await this.http(req);
		} catch (e) {
			throw new TelegramError(`Сеть недоступна: ${e instanceof Error ? e.message : String(e)}`);
		}
		let data: ApiResponse<T>;
		try {
			data = JSON.parse(res.text) as ApiResponse<T>;
		} catch {
			throw new TelegramError(`Telegram ответил HTTP ${res.status} без JSON`, res.status);
		}
		if (!data.ok) throw new TelegramError(data.description ?? `Ошибка ${data.error_code ?? res.status}`, data.error_code);
		return data.result as T;
	}

	getMe(): Promise<User> {
		return this.call<User>("getMe", {});
	}

	/** Последние личные чаты, из которых писали боту (нужно для «Определить chat_id») */
	async recentPrivateChats(): Promise<Chat[]> {
		const updates = await this.call<Update[]>("getUpdates", { limit: 100, allowed_updates: ["message"] });
		const chats = new Map<number, Chat>();
		for (const u of updates.reverse()) {
			const c = u.message?.chat;
			if (c && c.type === "private" && !chats.has(c.id)) chats.set(c.id, c);
		}
		return [...chats.values()];
	}

	sendRichMessage(target: Target, rich: InputRichMessage, files: UploadFile[] = [], silent = false): Promise<Message> {
		return this.call<Message>(
			"sendRichMessage",
			{
				chat_id: normalizeChatId(target.chatId),
				message_thread_id: target.threadId,
				rich_message: rich,
				disable_notification: silent || undefined,
			},
			files,
		);
	}

	editRichMessage(chatId: string | number, messageId: number, rich: InputRichMessage, files: UploadFile[] = []): Promise<Message | true> {
		return this.call<Message | true>(
			"editMessageText",
			{ chat_id: normalizeChatId(chatId), message_id: messageId, rich_message: rich },
			files,
		);
	}
}
