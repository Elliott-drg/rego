// Chargeur commun des scripts de relecture (lecture seule des données embarquées).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
export const rd = (f, T) => { const b = fs.readFileSync(path.join(ROOT, 'public/data', f)); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
globalThis.fetch = async (url) => { const b = fs.readFileSync(path.join(ROOT, 'public', url)); return { ok: true, headers: { get: () => null }, body: null, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b.toString('utf8')) }; };
export const terrain = await import('../../public/js/science/terrain.js');
export const dem = rd('sp_dem_240m.i16', Int16Array);
terrain.setDem(dem);
