import { MarkdownView, Notice, Plugin, requestUrl, TAbstractFile, TFile } from "obsidian";
import { convert, ConvertResult, extOf, MAX_LENGTH, MAX_MEDIA } from "./convert";
import { SendModal } from "./modal";
import { DEFAULT_SETTINGS, Settings, SettingsTab, TOKEN_SECRET } from "./settings";
import { infoMessage } from "./info";
import { HttpFn, InputRichMessage, mimeOf, TelegramClient, TelegramError, UploadFile } from "./telegram";

const MB = 1024 * 1024;

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
			id: "send",
			name: "Отправить в Telegram",
			checkCallback: (checking) => this.withActiveNote(checking, (f) => this.openModal(f)),
		});
		this.addCommand({
			id: "send-selection",
			name: "Отправить выделенное в Telegram",
			editorCheckCallback: (checking, editor, ctx) => {
				if (!editor.somethingSelected() || !ctx.file) return false;
				if (!checking) void this.publish(ctx.file, editor.getSelection());
				return true;
			},
		});
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((i) => i.setTitle("Отправить в Telegram").setIcon("send").onClick(() => this.openModal(file)));
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				if (!editor.somethingSelected() || !info.file) return;
				const file = info.file;
				menu.addItem((i) =>
					i.setTitle("Отправить выделенное в Telegram").setIcon("send").onClick(() => this.publish(file, editor.getSelection())),
				);
			}),
		);
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<Settings> & { tokenSecret?: string };
		// 1.x: токен лежал в секрете с именем из настроек — переносим под постоянное имя
		if (data.tokenSecret && !this.token()) {
			const old = this.app.secretStorage.getSecret(data.tokenSecret);
			if (old) this.app.secretStorage.setSecret(TOKEN_SECRET, old);
		}
		this.settings = {
			chatId: data.chatId ?? DEFAULT_SETTINGS.chatId,
			tidyWhitespace: data.tidyWhitespace ?? DEFAULT_SETTINGS.tidyWhitespace,
			paragraphGap: data.paragraphGap ?? DEFAULT_SETTINGS.paragraphGap,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	token(): string {
		return this.app.secretStorage.getSecret(TOKEN_SECRET)?.trim() ?? "";
	}

	setToken(value: string): void {
		this.app.secretStorage.setSecret(TOKEN_SECRET, value.trim());
	}

	client(): TelegramClient {
		return new TelegramClient(this.token(), http);
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
			tidyWhitespace: this.settings.tidyWhitespace,
			paragraphGap: this.settings.paragraphGap,
			lineBreaks: !this.strictLineBreaks(),
			resolveLink: (lp) => this.app.metadataCache.getFirstLinkpathDest(lp, file.path)?.path ?? null,
		});
	}

	/** Настройка Obsidian «Строгие переносы строк»: без неё одиночный Enter — новая строка */
	private strictLineBreaks(): boolean {
		const vault = this.app.vault as unknown as { getConfig?: (key: string) => unknown };
		return vault.getConfig?.("strictLineBreaks") === true;
	}

	async openModal(file: TFile): Promise<void> {
		new SendModal(this, file, await this.readNote(file)).open();
	}

	/** Справка (название заметки, время) и следом пост — всегда новыми сообщениями */
	async publish(file: TFile, text: string): Promise<boolean> {
		if (!this.token() || !this.settings.chatId) {
			new Notice("Заполните токен бота и ваш ID в настройках плагина «Telegram-статьи»");
			return false;
		}

		const result = this.convertFor(file, text);
		if (!result.markdown.trim()) {
			new Notice("Нечего отправлять: после конвертации текст пустой");
			return false;
		}
		if (result.length > MAX_LENGTH) {
			new Notice(
				`Не отправлено: ${result.length} символов при лимите ${MAX_LENGTH}. Снимите галочки с части разделов.`,
				15000,
			);
			return false;
		}
		if (result.media.length > MAX_MEDIA) {
			new Notice(`Не отправлено: ${result.media.length} вложений при лимите ${MAX_MEDIA}`, 10000);
			return false;
		}

		const progress = new Notice("Отправляю в Telegram…", 0);
		try {
			const files = await this.loadMedia(result);
			const rich: InputRichMessage = { markdown: result.markdown };
			if (result.media.length) {
				rich.media = result.media.map((m) => ({ id: m.id, media: { type: m.kind, media: `attach://${m.id}` } }));
			}
			const client = this.client();

			const target = { chatId: this.settings.chatId };
			await client.sendRichMessage(target, { markdown: infoMessage(file.basename, new Date()) });
			await client.sendRichMessage(target, rich, files);
			new Notice("Отправлено в Telegram");
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
