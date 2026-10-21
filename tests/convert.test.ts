import { describe, expect, it } from "vitest";
import { convert, MAX_LENGTH } from "../src/convert";

const md = (src: string, opts = {}) => convert(src, opts).markdown;
const vaultFiles = new Map([
	["кот.png", "Вложения/кот.png"],
	["Вложения/кот.png", "Вложения/кот.png"],
	["доклад.pdf", "Файлы/доклад.pdf"],
	["клип.mp4", "Видео/клип.mp4"],
	["папка с пробелом/схема.jpg", "папка с пробелом/схема.jpg"],
]);
const resolveLink = (p: string) => vaultFiles.get(p) ?? null;

describe("frontmatter, комментарии, теги", () => {
	it("вырезает frontmatter", () => {
		expect(md("---\ntitle: x\ntags: [a]\n---\n# Заголовок\nТекст")).toBe("# Заголовок\nТекст");
	});

	it("не трогает --- посреди текста", () => {
		expect(md("Текст\n\n---\n\nЕщё")).toBe("Текст\n\n---\n\nЕщё");
	});

	it("вырезает %%комментарии%%, в том числе многострочные", () => {
		expect(md("До %%скрыто%% после")).toBe("До после");
		expect(md("А\n%%\nмного\nстрок\n%%\nБ")).toBe("А\n\nБ");
	});

	it("вырезает dataview и dataviewjs", () => {
		expect(md("А\n```dataview\nLIST FROM #x\n```\nБ\n```dataviewjs\ndv.list([1])\n```")).toBe("А  \nБ");
	});

	it("вырезает строки с тегами в конце заметки", () => {
		expect(md("Текст про #теги внутри\n\n#проект #идея/черновик\n#ещё\n")).toBe("Текст про #теги внутри");
	});

	it("не путает заголовок с тегом", () => {
		expect(md("Текст\n\n# Итог")).toBe("Текст\n\n# Итог");
	});

	it("убирает ^block-id", () => {
		expect(md("Абзац с якорем ^abc123\nДальше")).toBe("Абзац с якорем  \nДальше");
	});
});

describe("вики-ссылки", () => {
	it("[[Заметка]] → текст", () => {
		expect(md("См. [[Заметка]].")).toBe("См. Заметка.");
	});

	it("[[Заметка|алиас]] → алиас", () => {
		expect(md("См. [[Папка/Заметка|вот тут]].")).toBe("См. вот тут.");
	});

	it("ссылки на заголовки и блоки", () => {
		expect(md("[[Заметка#Раздел]] и [[#Локальный]] и [[Заметка#^abc]]")).toBe("Заметка › Раздел и Локальный и Заметка");
	});

	it("экранированный | внутри таблицы", () => {
		expect(md("| a | b |\n|---|---|\n| [[Заметка\\|алиас]] | 2 |")).toBe("| a | b |\n|---|---|\n| алиас | 2 |");
	});

	it("обычные markdown-ссылки остаются как есть", () => {
		expect(md("[сайт](https://example.com/a_b?x=1)")).toBe("[сайт](https://example.com/a_b?x=1)");
	});
});

describe("выделение", () => {
	it("по умолчанию оставляет нативное ==marked==", () => {
		expect(md("Это ==важно== тут")).toBe("Это ==важно== тут");
	});

	it("по опции превращает в жирный", () => {
		expect(md("Это ==важно== и ==ещё==", { highlightAsBold: true })).toBe("Это **важно** и **ещё**");
	});

	it("не трогает == в сравнении", () => {
		expect(md("a == b", { highlightAsBold: true })).toBe("a == b");
	});
});

describe("callout'ы", () => {
	it("обычный → цитата с жирным заголовком", () => {
		expect(md("> [!note] Важно\n> Первая строка\n> Вторая")).toBe("> **📝 Важно**\n>\n> Первая строка  \n> Вторая");
	});

	it("без заголовка берёт тип", () => {
		expect(md("> [!warning]\n> Осторожно")).toBe("> **⚠️ Warning**\n>\n> Осторожно");
	});

	it("неизвестный тип — без иконки", () => {
		expect(md("> [!моё] Свой\n> текст")).toBe("> **Свой**\n>\n> текст");
	});

	it("сворачиваемый - → details, + → details open", () => {
		expect(md("> [!tip]- Подсказка\n> скрытый **текст**")).toBe(
			"<details><summary>**💡 Подсказка**</summary>\n\nскрытый **текст**\n\n</details>",
		);
		expect(md("> [!info]+ Раскрыто\n> текст")).toBe("<details open><summary>**ℹ️ Раскрыто**</summary>\n\nтекст\n\n</details>");
	});

	it("вложенный callout", () => {
		expect(md("> [!note] Внешний\n> текст\n> > [!tip] Внутренний\n> > совет")).toBe(
			"> **📝 Внешний**\n>\n> текст\n> > **💡 Внутренний**\n> >\n> > совет",
		);
	});

	it("обычная цитата остаётся цитатой", () => {
		expect(md("> просто цитата\n> вторая строка")).toBe("> просто цитата  \n> вторая строка");
	});

	it("код внутри сворачиваемого callout'а", () => {
		expect(md("> [!example]- Пример\n> ```js\n> const a = $x == [[b]];\n> ```")).toBe(
			"<details><summary>**🧪 Пример**</summary>\n\n```js\nconst a = $x == [[b]];\n```\n\n</details>",
		);
	});
});

describe("списки и таблицы", () => {
	it("вложенные списки и чеклисты не меняются", () => {
		const src = "- раз\n  - два\n    - три\n1. один\n   1. вложенный\n- [ ] задача\n- [x] сделано";
		expect(md(src)).toBe(src);
	});

	it("вики-ссылки внутри вложенного списка", () => {
		expect(md("- пункт\n  - см. [[Заметка|тут]]")).toBe("- пункт\n  - см. тут");
	});

	it("таблица с выравниванием не меняется", () => {
		const src = "| Имя | Цена |\n|:----|-----:|\n| Чай | 100 |";
		expect(md(src)).toBe(src);
	});

	it("предупреждает о таблице шире 20 колонок", () => {
		const head = "|" + Array.from({ length: 21 }, (_, i) => ` c${i} `).join("|") + "|";
		const sep = "|" + Array(21).fill("---").join("|") + "|";
		const r = convert(`${head}\n${sep}`);
		expect(r.warnings.join()).toMatch(/21 колон/);
	});
});

describe("код", () => {
	it("внутри огороженного блока ничего не трогает", () => {
		const src = "```python\n# не заголовок\nprice = '$5' # [[не ссылка]] ==нет== %%нет%%\n#tag\n```";
		expect(md(src)).toBe(src);
	});

	it("тильды и длинные ограды", () => {
		const src = "~~~\n$a$ ```\n~~~\n````md\n```\n[[x]]\n```\n````";
		expect(md(src)).toBe(src);
	});

	it("inline-код не трогает", () => {
		expect(md("Команда `echo $HOME [[x]] ==y==` тут")).toBe("Команда `echo $HOME [[x]] ==y==` тут");
	});

	it("код в конце заметки не принимается за теги", () => {
		expect(md("Текст\n\n```\n#tag\n```")).toBe("Текст\n\n```\n#tag\n```");
	});

	it("блок ```math остаётся", () => {
		expect(md("```math\nE = mc^2\n```")).toBe("```math\nE = mc^2\n```");
	});
});

describe("формулы и доллары", () => {
	it("inline-формула остаётся", () => {
		expect(md("Площадь $S = \\pi r^2$ круга")).toBe("Площадь $S = \\pi r^2$ круга");
	});

	it("однобуквенная формула", () => {
		expect(md("Пусть $x$ — число")).toBe("Пусть $x$ — число");
	});

	it("однострочная $$…$$ остаётся", () => {
		expect(md("$$E = mc^2$$")).toBe("$$E = mc^2$$");
	});

	it("многострочная $$ → ```math", () => {
		expect(md("До\n$$\na^2 + b^2\n= c^2\n$$\nПосле")).toBe("До\n```math\na^2 + b^2\n= c^2\n```\nПосле");
	});

	it("многострочная формула внутри callout'а", () => {
		expect(md("> [!note] Ф\n> $$\n> x = 1\n> $$")).toBe("> **📝 Ф**\n>\n> ```math\n> x = 1\n> ```");
	});

	it("цены экранируются", () => {
		expect(md("Стоит 100$ и 200$")).toBe("Стоит 100\\$ и 200\\$");
		expect(md("Было $100, стало $200")).toBe("Было \\$100, стало \\$200");
		expect(md("Один $ доллар")).toBe("Один \\$ доллар");
	});

	it("цена рядом с формулой", () => {
		expect(md("Цена $5, а $x^2$ — формула")).toBe("Цена \\$5, а $x^2$ — формула");
	});

	it("уже экранированный \\$ не удваивается", () => {
		expect(md("Цена \\$5")).toBe("Цена \\$5");
	});

	it("доллар в ссылке экранируется корректно", () => {
		expect(md("[x](https://e.com/?a=$1)")).toBe("[x](https://e.com/?a=\\$1)");
	});
});

describe("медиа", () => {
	it("![[картинка]] → tg://photo + список media", () => {
		const r = convert("![[кот.png]]", { resolveLink });
		expect(r.markdown).toBe("![](tg://photo?id=m1)");
		expect(r.media).toEqual([{ id: "m1", path: "Вложения/кот.png", kind: "photo" }]);
	});

	it("размер в ![[x|300]] отбрасывается, текст становится подписью", () => {
		expect(md("![[кот.png|300]]", { resolveLink })).toBe("![](tg://photo?id=m1)");
		expect(md("![[кот.png|Мой кот]]", { resolveLink })).toBe('![](tg://photo?id=m1 "Мой кот")');
	});

	it("локальный путь ![](…) с %20", () => {
		const r = convert("![схема](папка%20с%20пробелом/схема.jpg)", { resolveLink });
		expect(r.markdown).toBe('![](tg://photo?id=m1 "схема")');
		expect(r.media[0].path).toBe("папка с пробелом/схема.jpg");
	});

	it("видео и документ получают свои схемы", () => {
		const r = convert("![[клип.mp4]]\n\n![[доклад.pdf]]", { resolveLink });
		expect(r.markdown).toBe("![](tg://video?id=m1)\n\n![](tg://document?id=m2)");
		expect(r.media.map((m) => m.kind)).toEqual(["video", "document"]);
	});

	it("один файл дважды — одна загрузка", () => {
		const r = convert("![[кот.png]]\n\n![[Вложения/кот.png]]", { resolveLink });
		expect(r.media).toHaveLength(1);
	});

	it("картинка посреди абзаца выносится отдельным блоком", () => {
		expect(md("Смотри ![[кот.png]] вот", { resolveLink })).toBe("Смотри\n\n![](tg://photo?id=m1)\n\nвот");
	});

	it("картинка в пункте списка — блоком с отступом", () => {
		expect(md("- Кот: ![[кот.png]]", { resolveLink })).toBe("- Кот:\n\n  ![](tg://photo?id=m1)");
	});

	it("картинка внутри callout'а", () => {
		expect(md("> [!note] Фото\n> ![[кот.png]]", { resolveLink })).toBe("> **📝 Фото**\n>\n> ![](tg://photo?id=m1)");
	});

	it("ненайденный файл → название и предупреждение", () => {
		const r = convert("![[нет.png]]", { resolveLink });
		expect(r.markdown).toBe("нет.png");
		expect(r.warnings.join()).toMatch(/не найден/);
	});

	it("встраивание заметки → название", () => {
		const r = convert("![[Другая заметка#Раздел]]");
		expect(r.markdown).toBe("Другая заметка › Раздел");
		expect(r.warnings).toHaveLength(1);
	});

	it("внешняя картинка встраивается медиа-блоком", () => {
		expect(md("![логотип](https://example.com/a.png)")).toBe('![](https://example.com/a.png "логотип")');
	});

	it("внешняя картинка ссылкой, если встраивание выключено", () => {
		expect(md("![логотип](https://example.com/a.png)", { embedExternalMedia: false })).toBe(
			"[логотип](https://example.com/a.png)",
		);
	});

	it("медиа в ячейке таблицы — текстом", () => {
		const r = convert("| a |\n|---|\n| ![[кот.png]] |", { resolveLink });
		expect(r.markdown).toBe("| a |\n|---|\n| кот.png |");
		expect(r.media).toHaveLength(0);
	});
});

describe("пустые строки, пробелы, переносы", () => {
	const keep = { tidyWhitespace: false };

	it("по умолчанию сжимает пустые строки и двойные пробелы", () => {
		expect(md("Раз\n\n\n\nДва  слова   тут\n\n\n")).toBe("Раз\n\nДва слова тут");
	});

	it("без сжатия лишние пустые строки становятся пустыми абзацами", () => {
		expect(md("Раз\n\n\n\nДва", keep)).toBe("Раз\n\n&nbsp;\n\n&nbsp;\n\nДва");
		expect(md("Два  слова", keep)).toBe("Два  слова");
	});

	it("пустые строки в цитате сохраняются с префиксом", () => {
		expect(md("> раз\n>\n>\n> два", keep)).toBe("> раз\n>\n> &nbsp;\n>\n> два");
	});

	it("пустые строки внутри кода не трогает", () => {
		const src = "```\nа\n\n\n\nб   в\n```";
		expect(md(src)).toBe(src);
	});

	it("одиночный перенос — новая строка", () => {
		expect(md("строка 1\nстрока 2\nстрока 3")).toBe("строка 1  \nстрока 2  \nстрока 3");
	});

	it("со строгими переносами строки не трогает", () => {
		expect(md("строка 1\nстрока 2", { lineBreaks: false })).toBe("строка 1\nстрока 2");
	});

	it("не ставит перенос у заголовков, списков, таблиц, кода и html", () => {
		const src = "# Заголовок\nтекст\n- пункт\n- пункт\n\n| a |\n|---|\n| 1 |\n```\nкод\nкод\n```\n<details><summary>x</summary>";
		expect(md(src)).toBe(src);
	});

	it("перед заголовком и таблицей всегда пустая строка (иначе Telegram кладёт их в пункт списка)", () => {
		expect(md("- пункт\n### Заголовок\nтекст")).toBe("- пункт\n\n### Заголовок\nтекст");
		expect(md("Программа:\n| a | b |\n|---|---|\n| 1 | 2 |")).toBe("Программа:\n\n| a | b |\n|---|---|\n| 1 | 2 |");
		expect(md("> [!note] Т\n> текст\n> ## Заголовок")).toBe("> **📝 Т**\n>\n> текст\n>\n> ## Заголовок");
	});

	it("отделяет абзацы пустым абзацем, если включено", () => {
		const gap = { paragraphGap: true };
		expect(md("Раз\n\nДва\nещё", gap)).toBe("Раз\n\n&nbsp;\n\nДва  \nещё");
		expect(md("- пункт\n- пункт\n\nПлашка", gap)).toBe("- пункт\n- пункт\n\n&nbsp;\n\nПлашка");
		expect(md("Текст\n\n- пункт\n\n  второй абзац пункта", gap)).toBe("Текст\n\n- пункт\n\n  второй абзац пункта");
		expect(md("# Заголовок\n\nТекст\n\n| a |\n|---|\n\nПосле таблицы", gap)).toBe("# Заголовок\n\nТекст\n\n| a |\n|---|\n\nПосле таблицы");
		expect(md("> раз\n>\n> два", gap)).toBe("> раз\n>\n> два");
		expect(md("```\nкод\n```\n\nТекст", gap)).toBe("```\nкод\n```\n\nТекст");
	});

	it("отступ не удваивается с сохранёнными пустыми строками", () => {
		expect(md("Раз\n\n\nДва", { paragraphGap: true, tidyWhitespace: false })).toBe("Раз\n\n&nbsp;\n\nДва");
	});

	it("продолжение пункта списка переносится", () => {
		expect(md("- пункт\n  продолжение")).toBe("- пункт  \n  продолжение");
	});

	it("явный перенос из двух пробелов сохраняется", () => {
		expect(md("раз   \nдва", { lineBreaks: false })).toBe("раз  \nдва");
		expect(md("раз \nдва", { lineBreaks: false })).toBe("раз\nдва");
	});
});

describe("лимиты", () => {
	it("считает длину и предупреждает о превышении", () => {
		const r = convert("я".repeat(MAX_LENGTH + 1));
		expect(r.length).toBe(MAX_LENGTH + 1);
		expect(r.warnings.join()).toMatch(new RegExp(`${MAX_LENGTH + 1} из ${MAX_LENGTH}`));
	});

	it("эмодзи считаются одним символом", () => {
		expect(convert("😀😀").length).toBe(2);
	});
});
