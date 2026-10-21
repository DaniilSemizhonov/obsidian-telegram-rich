import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type TelegramRichPlugin from "./main";

export interface Settings {
	/** имя секрета в хранилище секретов Obsidian; сам токен в data.json не попадает */
	tokenSecret: string;
	chatId: string;
	threadId: string;
	highlightAsBold: boolean;
	embedExternalMedia: boolean;
	silent: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	tokenSecret: "",
	chatId: "",
	threadId: "",
	highlightAsBold: false,
	embedExternalMedia: true,
	silent: false,
};

export class SettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TelegramRichPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Токен бота")
			.setDesc("Хранится в хранилище секретов Obsidian на этом устройстве, а не в файлах хранилища. Создайте секрет и вставьте токен от @BotFather.")
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(s.tokenSecret).onChange(async (v) => {
					s.tokenSecret = v ?? "";
					await this.plugin.saveSettings();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Проверить").onClick(async () => {
					try {
						const me = await this.plugin.client().getMe();
						new Notice(`Бот @${me.username ?? me.first_name} на связи`);
					} catch (e) {
						this.plugin.showError(e);
					}
				}),
			);

		let chatInput: { setValue(v: string): unknown } | undefined;
		new Setting(containerEl)
			.setName("Мой chat_id")
			.setDesc("Ваш числовой id в Telegram. Напишите боту /start и нажмите «Определить».")
			.addText((t) => {
				chatInput = t;
				t.setPlaceholder("123456789")
					.setValue(s.chatId)
					.onChange(async (v) => {
						s.chatId = v.trim();
						await this.plugin.saveSettings();
					});
			})
			.addButton((b) =>
				b.setButtonText("Определить").onClick(async () => {
					try {
						const chats = await this.plugin.client().recentPrivateChats();
						if (!chats.length) {
							new Notice("Боту ещё никто не писал. Отправьте ему /start в Telegram и нажмите снова.");
							return;
						}
						const c = chats[0];
						s.chatId = String(c.id);
						chatInput?.setValue(s.chatId);
						await this.plugin.saveSettings();
						const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || c.id;
						new Notice(`chat_id ${c.id} (${name})` + (chats.length > 1 ? ` — взят последний из ${chats.length} чатов` : ""));
					} catch (e) {
						this.plugin.showError(e);
					}
				}),
			);

		new Setting(containerEl)
			.setName("Тема (message_thread_id)")
			.setDesc("Необязательно. Только если в личке с ботом включён режим тем.")
			.addText((t) =>
				t.setPlaceholder("пусто").setValue(s.threadId).onChange(async (v) => {
					s.threadId = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Оформление").setHeading();

		new Setting(containerEl)
			.setName("==Выделение== → жирный")
			.setDesc("Telegram умеет выделение маркером сам; включите, если нужен именно жирный.")
			.addToggle((t) =>
				t.setValue(s.highlightAsBold).onChange(async (v) => {
					s.highlightAsBold = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Встраивать внешние картинки")
			.setDesc("![](https://…) станет медиа в сообщении (Telegram скачает сам, фото до 5 МБ). Выключено — останется ссылкой.")
			.addToggle((t) =>
				t.setValue(s.embedExternalMedia).onChange(async (v) => {
					s.embedExternalMedia = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Без звука")
			.setDesc("Новые сообщения приходят без уведомления.")
			.addToggle((t) =>
				t.setValue(s.silent).onChange(async (v) => {
					s.silent = v;
					await this.plugin.saveSettings();
				}),
			);
	}
}
