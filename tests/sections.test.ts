import { describe, expect, it } from "vitest";
import { descendants, joinSections, splitSections } from "../src/sections";

const note = `---
tags: [x]
---
Вступление

# Глава 1
Текст 1
## Часть 1.1
Текст 1.1
\`\`\`
# не заголовок
\`\`\`
## Часть 1.2
# Глава 2
Текст 2`;

describe("splitSections", () => {
	const s = splitSections(note);

	it("находит разделы и пропускает заголовки в коде", () => {
		expect(s.map((x) => `${x.level}:${x.title}`)).toEqual([
			"0:Начало заметки", "1:Глава 1", "2:Часть 1.1", "2:Часть 1.2", "1:Глава 2",
		]);
	});

	it("строит иерархию", () => {
		expect(s.map((x) => x.parent)).toEqual([-1, -1, 1, 1, -1]);
		expect(descendants(s, 1)).toEqual([2, 3]);
		expect(descendants(s, 4)).toEqual([]);
	});

	it("собирает выбранное", () => {
		expect(joinSections(s, new Set([2, 4]))).toBe("## Часть 1.1\nТекст 1.1\n```\n# не заголовок\n```\n\n# Глава 2\nТекст 2");
	});

	it("без вступления", () => {
		expect(splitSections("# A\nтекст")[0].title).toBe("A");
	});
});
