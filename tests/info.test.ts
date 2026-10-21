import { describe, expect, it } from "vitest";
import { escapeMarkdown, formatDateTime, infoMessage } from "../src/info";

describe("справка перед постом", () => {
	it("форматирует дату и время", () => {
		expect(formatDateTime(new Date(2026, 9, 5, 9, 7))).toBe("05.10.2026 в 09:07");
	});

	it("собирает сообщение с названием и временем", () => {
		expect(infoMessage("Что такое инвариант", new Date(2026, 9, 21, 9, 45))).toBe("📄 **Что такое инвариант**  \n🕘 21.10.2026 в 09:45");
	});

	it("экранирует разметку в названии", () => {
		expect(escapeMarkdown("Цены $5 и *скидки* [№12] #тег")).toBe("Цены \\$5 и \\*скидки\\* \\[№12\\] \\#тег");
	});
});
