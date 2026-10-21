import { App, PluginSettingTab, Setting } from "obsidian";
import type TelegramRichPlugin from "./main";

/** id секрета в хранилище секретов Obsidian; сам токен в data.json не попадает */
export const TOKEN_SECRET = "telegram-rich-bot-token";

export interface Settings {
	/** личный чат, определяется автоматически при первой отправке */
	chatId: string;
	/** id бота, для которого найден chatId: сменился токен на другого бота — ищем заново */
	chatBotId: string;
	tidyWhitespace: boolean;
	paragraphGap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	chatId: "",
	chatBotId: "",
	tidyWhitespace: true,
	paragraphGap: true,
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
		containerEl.empty();

		new Setting(containerEl)
			.setName("Токен бота")
			.setDesc("Токен от @BotFather. Перед первой отправкой напишите своему боту /start в Telegram — сообщения будут приходить вам в личку.")
			.addText((t) => {
				t.inputEl.type = "password";
				t.setPlaceholder("123456789:AA…")
					.setValue(this.plugin.token())
					.onChange((v) => this.plugin.setToken(v));
			});
	}
}
