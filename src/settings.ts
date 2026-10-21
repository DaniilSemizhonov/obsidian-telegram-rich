import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import type TelegramRichPlugin from "./main";

/** id секрета в хранилище секретов Obsidian; сам токен в data.json не попадает */
export const TOKEN_SECRET = "telegram-rich-bot-token";

export interface Settings {
	/** ваш id в Telegram: бот пишет только сюда */
	chatId: string;
	tidyWhitespace: boolean;
	paragraphGap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	chatId: "",
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
			.setDesc("Токен от @BotFather.")
			.addText((t) => {
				t.inputEl.type = "password";
				t.setPlaceholder("123456789:AA…")
					.setValue(this.plugin.token())
					.onChange((v) => this.plugin.setToken(v));
			});

		let idInput: TextComponent | undefined;
		new Setting(containerEl)
			.setName("Ваш ID в Telegram")
			.setDesc("Бот пишет только на этот ID. Чтобы определить его, отправьте боту /start и нажмите «Определить».")
			.addText((t) => {
				idInput = t;
				t.setPlaceholder("123456789")
					.setValue(this.plugin.settings.chatId)
					.onChange(async (v) => {
						this.plugin.settings.chatId = v.trim();
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
						this.plugin.settings.chatId = String(c.id);
						idInput?.setValue(this.plugin.settings.chatId);
						await this.plugin.saveSettings();
						const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.username ? "@" + c.username : "");
						new Notice(`ID ${c.id}${name ? ` — ${name}` : ""}. Если это не вы, напишите боту /start и нажмите снова.`, 8000);
					} catch (e) {
						this.plugin.showError(e);
					}
				}),
			);
	}
}
