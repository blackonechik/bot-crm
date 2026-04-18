import { Keyboard } from '@maxhub/max-bot-api';
import { Markup } from 'telegraf';

function chunkLabels(labels: string[], size = 2): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < labels.length; index += size) {
    rows.push(labels.slice(index, index + size));
  }
  return rows;
}

export function telegramInlineKeyboard(labels: string[]) {
  const rows = chunkLabels(labels).map((row) => row.map((label) => Markup.button.callback(label, label)));
  return Markup.inlineKeyboard(rows);
}

export function maxInlineKeyboard(labels: string[]) {
  const rows = chunkLabels(labels).map((row) => row.map((label) => Keyboard.button.callback(label, label)));
  return Keyboard.inlineKeyboard(rows);
}
