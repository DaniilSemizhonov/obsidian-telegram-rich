// Разбивка заметки на разделы по заголовкам — для выборочной отправки.

import { stripFrontmatter } from "./convert";

export interface Section {
	/** 0 — текст до первого заголовка */
	level: number;
	title: string;
	/** строки раздела без вложенных подразделов (заголовок включительно) */
	text: string;
	/** индекс родительского раздела или -1 */
	parent: number;
}

export function splitSections(src: string): Section[] {
	const lines = stripFrontmatter(src.replace(/\r\n?/g, "\n")).split("\n");
	const sections: Section[] = [];
	const stack: number[] = [];
	let current: { level: number; title: string; lines: string[]; parent: number } = {
		level: 0, title: "Начало заметки", lines: [], parent: -1,
	};
	let fence: string | null = null;

	const flush = (): void => {
		if (current.level > 0 || current.lines.some((l) => l.trim())) {
			sections.push({ level: current.level, title: current.title, text: current.lines.join("\n"), parent: current.parent });
		}
	};

	for (const line of lines) {
		const f = /^\s*(`{3,}|~{3,})/.exec(line);
		if (f) {
			if (!fence) fence = f[1];
			else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length)) fence = null;
		}
		const h = fence ? null : /^(#{1,6})[ \t]+(.+?)[ \t#]*$/.exec(line);
		if (!h) {
			current.lines.push(line);
			continue;
		}
		flush();
		const level = h[1].length;
		while (stack.length && sections[stack[stack.length - 1]].level >= level) stack.pop();
		const parent = stack.length ? stack[stack.length - 1] : -1;
		current = { level, title: h[2], lines: [line], parent };
		stack.push(sections.length);
	}
	flush();
	return sections;
}

/** Все потомки раздела i */
export function descendants(sections: Section[], i: number): number[] {
	const res: number[] = [];
	for (let k = i + 1; k < sections.length; k++) {
		let p = sections[k].parent;
		while (p !== -1 && p !== i) p = sections[p].parent;
		if (p === i) res.push(k);
	}
	return res;
}

export function joinSections(sections: Section[], selected: ReadonlySet<number>): string {
	return sections
		.filter((_, i) => selected.has(i))
		.map((s) => s.text.replace(/\n+$/, ""))
		.join("\n\n");
}
