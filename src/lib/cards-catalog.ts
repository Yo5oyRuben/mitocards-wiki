import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CardRecord = {
  id: string;
  nombre: string;
  xeno?: number;
  huecos?: number;
  salud?: number | string;
  ataque?: number | string;
  tipo?: string;
  naturaleza?: string;
  habilidad?: string;
  descripcion?: string;
  ilustracion_h?: string;
  ilustracion_m?: string;
  ilustracion_l?: string;
  ilustracion_carta_h?: string;
  ilustracion_carta_m?: string;
  ilustracion_carta_l?: string;
  [key: string]: unknown;
};

let cache: CardRecord[] | null = null;

function normalizeId(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeCard(value: unknown): CardRecord | null {
  if (!value || typeof value !== 'object') return null;
  const card = value as Record<string, unknown>;
  const id = normalizeId(card.id ?? card.slug ?? card.nombre ?? card.name);
  if (!id) return null;
  return {
    ...card,
    id,
    nombre: String(card.nombre ?? card.name ?? id),
  } as CardRecord;
}

export async function getCardsCatalog(): Promise<CardRecord[]> {
  if (cache) return cache;
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = resolve(dir, '..', '..', 'public', 'cards.json');
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('public/cards.json debe ser un array');
  }
  cache = parsed.map(normalizeCard).filter((c): c is CardRecord => Boolean(c));
  return cache;
}
