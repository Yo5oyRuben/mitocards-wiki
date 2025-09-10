// ================================================
// FILE: src/lib/deck.ts
// Tipos + validación + helpers de (des)serialización
// ================================================
export type CartaID = string;

export interface DeckMeta {
  version: number;
  nombre: string;
  publico: boolean;
  xenoMax: number;
  huecosMax: number;
  xenoTotal: number; // calculado al guardar
}

export interface DeckFile extends DeckMeta {
  cartas: CartaID[]; // en orden
}

export function computeXenoTotal(ids: CartaID[], catalog: any[]): number {
  const map = new Map<string, number>();
  for (const c of catalog) map.set(c.id, Number(c.xeno) || 0);
  return ids.reduce((acc, id) => acc + (map.get(id) ?? 0), 0);
}

export function isValidDeck(ids: CartaID[], meta: { xenoMax: number; huecosMax: number; }, catalog: any[]) {
  const { xenoMax, huecosMax } = meta;
  // 1) Longitud exacta = huecosMax
  const full = ids.length === huecosMax && ids.every(Boolean);
  // 2) Sin duplicados por id
  const dupFree = new Set(ids).size === ids.length;
  // 3) Xeno ≤ xenoMax
  const xenoTotal = computeXenoTotal(ids, catalog);
  const xenoOk = xenoTotal <= xenoMax;
  return { full, dupFree, xenoOk, xenoTotal, valid: full && dupFree && xenoOk };
}

export function toDeckFile(params: { nombre: string; publico: boolean; xenoMax: number; huecosMax: number; cartas: CartaID[]; catalog: any[]; }): DeckFile {
  const { nombre, publico, xenoMax, huecosMax, cartas, catalog } = params;
  const xenoTotal = computeXenoTotal(cartas, catalog);
  return { version: 1, nombre, publico, xenoMax, huecosMax, xenoTotal, cartas };
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function saveLocalDraft(deck: DeckFile) {
  const key = 'mitocards:mazos:drafts';
  const list: DeckFile[] = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = list.findIndex(d => d.nombre === deck.nombre);
  if (idx >= 0) list[idx] = deck; else list.push(deck);
  localStorage.setItem(key, JSON.stringify(list));
}

export function loadLocalDrafts(): DeckFile[] {
  try { return JSON.parse(localStorage.getItem('mitocards:mazos:drafts') || '[]'); }
  catch { return []; }
}

export function tryParseDeckFile(text: string): DeckFile | null {
  try { const obj = JSON.parse(text); if (obj && Array.isArray(obj.cartas)) return obj as DeckFile; } catch {}
  return null;
}