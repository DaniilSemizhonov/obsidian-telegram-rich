import { MarkdownView, Notice, Plugin, requestUrl, TAbstractFile, TFile } from "obsidian";
import { convert, ConvertResult, extOf, MAX_LENGTH, MAX_MEDIA } from "./convert";
import { SendModal } from "./modal";
import { DEFAULT_SETTINGS, Settings, SettingsTab } from "./settings";
import { HttpFn, InputRichMessage, mimeOf, TelegramClient, TelegramError, UploadFile } from "./telegram";

const MB = 1024 * 1024;

export interface PublishOptions {
	/** записывать tg_chat_id/tg_message_id и редактировать по ним при повторной отправке */
	track: boolean;
	/** игнорировать сохранённые id и отправить новое сообщение */
	forceNew?: boolean;
}

interface Published {
	chatId: string | number;
	messageId: number;
}

const http: HttpFn = async (req) => {
	const res = await requestUrl({ ...req, throw: false });
	return { status: res.status, text: res.text };
};

export default class TelegramRichPlugin extends Plugin {
	settings: Settings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new SettingsTab(this.app, this));

		this.addCommand({
			id: "send-note",
			name: "Отправить заметку в Telegram",
			checkCallback: (checking) => this.withActiveNote(checking, (f) => this.sendNote(f, { track: true })),
		});
		this.addCommand({
			id: "send-note-new",
			name: "Отправить заметку в Telegram как новое сообщение",
			checkCallback: (checking) => this.withActiveNote(checking, (f) => this.sendNote(f, { track: true, forceNew: true })),
		});
		this.addCommand({
			id: "send-selection",
			name: "Отправить выделенное в Telegram",
			editorCheckCallback: (checking, editor, ctx) => {
				if (!editor.somethingSelected() || !ctx.file) return false;
				if (!checking) void this.publish(ctx.file, editor.getSelection(), { track: false });
				return true;
			},
		});
		this.addCommand({
			id: "preview",
			name: "Предпросмотр и выбор разделов для Telegram",
			checkCallback: (checking) => this.withActiveNote(checking, (f) => this.openModal(f)),
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((i) => i.setTitle("Отправить в Telegram").setIcon("send").onClick(() => this.sendNote(file, { track: true })));
				menu.addItem((i) => i.setTitle("Telegram: выбрать разделы…").setIcon("list-checks").onClick(() => this.openModal(file)));
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				if (!editor.somethingSelected() || !info.file) return;
				const file = info.file;
				menu.addItem((i) =>
					i.setTitle("Отправить выделенное в Telegram").setIcon("send").onClick(() => this.publish(file, editor.getSelection(), { track: false })),
				);
			}),
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<Settings> | null) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	client(): TelegramClient {
		const token = this.settings.tokenSecret ? this.app.secretStorage.getSecret(this.settings.tokenSecret) : null;
		return new TelegramClient(token?.trim() ?? "", http);
	}

	showError(e: unknown): void {
		const msg = e instanceof TelegramError ? e.description : e instanceof Error ? e.message : String(e);
		new Notice(`Telegram: ${msg}`, 10000);
		if (!(e instanceof TelegramError)) console.error(e);
	}

	private withActiveNote(checking: boolean, run: (f: TFile) => unknown): boolean {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") return false;
		if (!checking) void run(file);
		return true;
	}

	/** Текст заметки: из открытого редактора (там самое свежее), иначе с диска */
	async readNote(file: TFile): Promise<string> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) return view.editor.getValue();
		}
		return this.app.vault.read(file);
	}

	convertFor(file: TFile, text: string): ConvertResult {
		return convert(text, {
			highlightAsBold: this.settings.highlightAsBold,
			embedExternalMedia: this.settings.embedExternalMedia,
			tidyWhitespace: this.settings.tidyWhitespace,
			lineBreaks: !this.strictLineBreaks(),
			resolveLink: (lp) => this.app.metadataCache.getFirstLinkpathDest(lp, file.path)?.path ?? null,
		});
	}

	/** Настройка Obsidian «Строгие переносы строк»: без неё одиночный Enter — новая строка */
	private strictLineBreaks(): boolean {
		const vault = this.app.vault as unknown as { getConfig?: (key: string) => unknown };
		return vault.getConfig?.("strictLineBreaks") === true;
	}

	/** Сохранённое во frontmatter сообщение, если есть */
	published(file: TFile): Published | null {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const chatId: unknown = fm?.tg_chat_id;
		const messageId = Number(fm?.tg_message_id);
		if ((typeof chatId !== "string" && typeof chatId !== "number") || !Number.isInteger(messageId)) return null;
		return { chatId, messageId };
	}

	async openModal(file: TFile): Promise<void> {
		new SendModal(this, file, await this.readNote(file)).open();
	}

	async sendNote(file: TFile, opts: PublishOptions): Promise<void> {
		await this.publish(file, await this.readNote(file), opts);
	}

	async publish(file: TFile, text: string, opts: PublishOptions): Promise<boolean> {
		const s = this.settings;
		const prev = opts.track && !opts.forceNew ? this.published(file) : null;
		if (!prev && !s.chatId) {
			new Notice("Укажите chat_id в настройках плагина «Telegram-статьи»");
			return false;
		}

		const result = this.convertFor(file, text);
		if (!result.markdown.trim()) {
			new Notice("Нечего отправлять: после конвертации текст пустой");
			return false;
		}
		if (result.length > MAX_LENGTH) {
			new Notice(
				`Не отправлено: ${result.length} символов при лимите ${MAX_LENGTH}. Уберите часть текста или отправьте разделами через «Предпросмотр и выбор разделов».`,
				15000,
			);
			return false;
		}
		if (result.media.length > MAX_MEDIA) {
			new Notice(`Не отправлено: ${result.media.length} вложений при лимите ${MAX_MEDIA}`, 10000);
			return false;
		}

		const progress = new Notice(prev ? "Обновляю сообщение в Telegram…" : "Отправляю в Telegram…", 0);
		try {
			const files = await this.loadMedia(result);
			const rich: InputRichMessage = { markdown: result.markdown };
			if (result.media.length) {
				rich.media = result.media.map((m) => ({ id: m.id, media: { type: m.kind, media: `attach://${m.id}` } }));
			}
			const client = this.client();

			if (prev) {
				try {
					await client.editRichMessage(prev.chatId, prev.messageId, rich, files);
					new Notice("Сообщение в Telegram обновлено");
				} catch (e) {
					if (e instanceof TelegramError && e.notModified) {
						new Notice("В Telegram уже актуальная версия");
					} else if (e instanceof TelegramError && e.messageGone) {
						new Notice(`Telegram: ${e.description}\nСообщение не найти — используйте «Отправить как новое сообщение».`, 15000);
						return false;
					} else throw e;
				}
			} else {
				const threadId = Number(s.threadId);
				const msg = await client.sendRichMessage(
					{ chatId: s.chatId, threadId: s.threadId && Number.isInteger(threadId) ? threadId : undefined },
					rich,
					files,
					s.silent,
				);
				if (opts.track) {
					await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
						fm.tg_chat_id = msg.chat.id;
						fm.tg_message_id = msg.message_id;
					});
				}
				new Notice("Отправлено в Telegram");
			}
			if (result.warnings.length) new Notice("Есть замечания:\n• " + result.warnings.join("\n• "), 10000);
			return true;
		} catch (e) {
			this.showError(e);
			return false;
		} finally {
			progress.hide();
		}
	}

	private async loadMedia(result: ConvertResult): Promise<UploadFile[]> {
		const files: UploadFile[] = [];
		for (const m of result.media) {
			const f = this.app.vault.getAbstractFileByPath(m.path);
			if (!(f instanceof TFile)) throw new Error(`Вложение пропало: ${m.path}`);
			const limit = m.kind === "photo" ? 10 * MB : 50 * MB;
			if (f.stat.size > limit) {
				throw new Error(`${f.name}: ${(f.stat.size / MB).toFixed(1)} МБ, Telegram принимает до ${limit / MB} МБ`);
			}
			files.push({ field: m.id, fileName: f.name, mimeType: mimeOf(extOf(f.name)), data: await this.app.vault.readBinary(f) });
		}
		return files;
	}
}
