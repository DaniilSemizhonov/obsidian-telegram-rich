// Сообщение-справка, которое уходит перед постом.

/** Экранирует текст, чтобы Rich Markdown показал его как есть */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_~[\]()<>|=$#!+-]/g, "\\$&");
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatDateTime(d: Date): string {
	return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} в ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function infoMessage(title: string, sentAt: Date): string {
	return `📄 **${escapeMarkdown(title)}**  \n🕘 ${formatDateTime(sentAt)}`;
}
