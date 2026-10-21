import { ButtonComponent, Modal, Notice, TFile } from "obsidian";
import { MAX_LENGTH, MAX_MEDIA } from "./convert";
import type TelegramRichPlugin from "./main";
import { descendants, joinSections, Section, splitSections } from "./sections";

/** Выбор разделов заметки по заголовкам + живой предпросмотр того, что уйдёт в API */
export class SendModal extends Modal {
	private sections: Section[];
	private selected: Set<number>;
	private boxes: HTMLInputElement[] = [];
	private infoEl!: HTMLElement;
	private warnEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private sendBtn!: ButtonComponent;
	private newBtn!: ButtonComponent;
	private markdown = "";

	constructor(
		private plugin: TelegramRichPlugin,
		private file: TFile,
		private text: string,
	) {
		super(plugin.app);
		this.sections = splitSections(text);
		this.selected = new Set(this.sections.map((_, i) => i));
	}

	onOpen(): void {
		this.modalEl.addClass("tg-rich-modal");
		this.setTitle(`Telegram: ${this.file.basename}`);
		const { contentEl } = this;
		const body = contentEl.createDiv("tg-rich-body");

		const tree = body.createDiv("tg-rich-tree");
		const tools = tree.createDiv("tg-rich-tree-tools");
		tools.createEl("a", { text: "все" }).onclick = () => this.setAll(true);
		tools.createSpan({ text: " · " });
		tools.createEl("a", { text: "ничего" }).onclick = () => this.setAll(false);

		this.sections.forEach((s, i) => {
			const row = tree.createEl("label", { cls: "tg-rich-row" });
			row.style.paddingLeft = `${Math.max(0, s.level - 1) * 14}px`;
			const box = row.createEl("input", { type: "checkbox" });
			box.checked = true;
			box.onchange = () => this.toggle(i, box.checked);
			row.createSpan({ text: s.title, cls: s.level === 0 ? "tg-rich-preamble" : "" });
			this.boxes.push(box);
		});

		const right = body.createDiv("tg-rich-right");
		this.infoEl = right.createDiv("tg-rich-info");
		this.warnEl = right.createDiv("tg-rich-warn");
		this.previewEl = right.createEl("pre", { cls: "tg-rich-preview" });

		const buttons = contentEl.createDiv("tg-rich-buttons");
		const tidy = buttons.createEl("label", { cls: "tg-rich-tidy" });
		const tidyBox = tidy.createEl("input", { type: "checkbox" });
		tidyBox.checked = this.plugin.settings.tidyWhitespace;
		tidy.appendText("Убирать лишние пустые строки и пробелы");
		tidyBox.onchange = async () => {
			this.plugin.settings.tidyWhitespace = tidyBox.checked;
			await this.plugin.saveSettings();
			this.refresh();
		};

		new ButtonComponent(buttons).setButtonText("Скопировать").onClick(async () => {
			await navigator.clipboard.writeText(this.markdown);
			new Notice("Rich Markdown скопирован");
		});
		this.newBtn = new ButtonComponent(buttons).setButtonText("Отправить как новое").onClick(() => this.send(true));
		this.sendBtn = new ButtonComponent(buttons).setCta().onClick(() => this.send(false));

		this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private get whole(): boolean {
		return this.selected.size === this.sections.length;
	}

	private toggle(i: number, on: boolean): void {
		for (const k of [i, ...descendants(this.sections, i)]) {
			if (on) this.selected.add(k);
			else this.selected.delete(k);
			this.boxes[k].checked = on;
		}
		this.refresh();
	}

	private setAll(on: boolean): void {
		this.sections.forEach((_, i) => {
			if (on) this.selected.add(i);
			else this.selected.delete(i);
			this.boxes[i].checked = on;
		});
		this.refresh();
	}

	private selectedText(): string {
		return this.whole ? this.text : joinSections(this.sections, this.selected);
	}

	private refresh(): void {
		const r = this.plugin.convertFor(this.file, this.selectedText());
		this.markdown = r.markdown;
		this.previewEl.setText(r.markdown || "— ничего не выбрано —");

		this.infoEl.empty();
		const len = this.infoEl.createSpan({ text: `${r.length} / ${MAX_LENGTH} символов` });
		len.toggleClass("tg-rich-over", r.length > MAX_LENGTH);
		if (r.media.length) {
			const m = this.infoEl.createSpan({ text: ` · вложений: ${r.media.length} / ${MAX_MEDIA}` });
			m.toggleClass("tg-rich-over", r.media.length > MAX_MEDIA);
		}

		this.warnEl.empty();
		for (const w of r.warnings) this.warnEl.createDiv({ text: "⚠ " + w });

		const prev = this.plugin.published(this.file);
		const empty = !r.markdown.trim();
		const tooBig = r.length > MAX_LENGTH || r.media.length > MAX_MEDIA;
		// редактируется только сообщение с целой заметкой; части всегда уходят новым
		this.sendBtn.setButtonText(this.whole && prev ? "Обновить в Telegram" : "Отправить");
		this.sendBtn.setDisabled(empty || tooBig);
		this.newBtn.setDisabled(empty || tooBig);
		this.newBtn.buttonEl.toggle(this.whole && !!prev);
	}

	private async send(forceNew: boolean): Promise<void> {
		this.sendBtn.setDisabled(true);
		this.newBtn.setDisabled(true);
		const ok = await this.plugin.publish(this.file, this.selectedText(), { track: this.whole, forceNew });
		if (ok) this.close();
		else this.refresh();
	}
}
