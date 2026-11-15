// Connecteur du serveur local (server.mjs) : état, test des sources, téléchargements à la demande, cache disque.
// L'interface ne parle jamais directement aux routes /api : elle passe par ces fonctions, qui renvoient
// des objets simples ou lèvent une ConnectorError dont le `code` est traduit par l'interface (dc.err.<code>).
//
// Codes : no_server (serveur local absent), offline, upstream_unreachable, upstream_timeout, upstream,
//         bad_request, busy, cancelled, incomplete, server_error.

import { state, set } from '../../core/store.js';

export class ConnectorError extends Error {
  /** @param {string} code @param {string} [message] texte du serveur (français) @param {string} [detail] code technique (ENOTFOUND…) */
  constructor(code, message = '', detail = '') { super(message || code); this.name = 'ConnectorError'; this.code = code; this.detail = detail; }
}

const STATUS_TTL_MS = 4000;
let statusMemo = { at: 0, value: null, pending: null };

/**
 * État de l'environnement : serveur local présent ? accès à Internet ?
 * Avec le serveur local, « en ligne » est ce que LUI constate (c'est lui qui sort sur Internet) ;
 * sans lui, on se rabat sur ce que dit le navigateur. Met à jour `state.server`.
 * @returns {Promise<{server:boolean, online:boolean, info:object|null}>}
 */
export function serverStatus({ force = false } = {}) {
  if (!force && statusMemo.value && Date.now() - statusMemo.at < STATUS_TTL_MS) return Promise.resolve(statusMemo.value);
  statusMemo.pending ??= (async () => {
    let info = null;
    try {
      const r = await fetch('api/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const j = r.ok ? await r.json() : null;
      if (j && j.app === 'regolith-finder') info = j;
    } catch { /* pas de serveur local (serveur statique simple, ou page ouverte autrement) */ }
    const value = { server: !!info, online: info ? !!info.online : (typeof navigator === 'undefined' || navigator.onLine !== false), info };
    statusMemo = { at: Date.now(), value, pending: null };
    set({ server: value.server });
    return value;
  })();
  return statusMemo.pending;
}

/** Lève « no_server » si le serveur local est absent (en le vérifiant si l'on ne sait pas encore). */
export async function requireServer() {
  if (state.server === null) await serverStatus();
  if (!state.server) throw new ConnectorError('no_server');
}

/** Appel JSON d'une route interne ; convertit les échecs en ConnectorError. */
async function api(path, init) {
  await requireServer();
  let res;
  try { res = await fetch(path, { cache: 'no-store', ...init }); } catch (e) {
    if (e?.name === 'AbortError') throw new ConnectorError('cancelled');
    set({ server: false }); statusMemo.at = 0;          // le serveur a disparu en cours de route
    throw new ConnectorError('no_server');
  }
  let body = null;
  try { body = await res.json(); } catch { /* réponse non JSON */ }
  if (res.ok && body) return body;
  const err = body?.error;
  if (!err) throw new ConnectorError(res.status === 404 ? 'no_server' : 'server_error', `HTTP ${res.status}`);
  throw new ConnectorError(err.code || 'server_error', err.message, err.detail || err.param || '');
}

/** Teste l'adresse officielle d'une source du catalogue. @returns {{id, url, ok, status, ms, method, checked_at, error?}} */
export function probeSource(id) { return api(`api/probe?id=${encodeURIComponent(id)}`); }

/** Contenu du cache disque du serveur local. @returns {{dir, files:Array, count, bytes}} */
export function diskCache() { return api('api/cache'); }

/** Supprime une entrée du cache disque : id de produit, 'horizons', 'horizons:<clé>' ou 'all'. */
export function deleteDiskCache(id) { return api(`api/cache?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); }

/**
 * Télécharge un produit de la liste blanche dans le cache disque, avec suivi de progression.
 * Si une partie du fichier a déjà été reçue, le serveur reprend là où il s'était arrêté.
 * @param {string} id @param {{onProgress?:(p:{received:number,total:number|null,resumedFrom:number,hashing:boolean})=>void, signal?:AbortSignal, refresh?:boolean}} [opts]
 * @returns {Promise<object>} métadonnées : {id, file, bytes, sha256, url, source, fetched_at, cached, resumed_from}
 */
export async function fetchProduct(id, { onProgress, signal, refresh = false } = {}) {
  await requireServer();
  let res;
  try { res = await fetch(`api/fetch?id=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`, { cache: 'no-store', signal }); } catch (e) {
    throw new ConnectorError(e?.name === 'AbortError' ? 'cancelled' : 'no_server');
  }
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null))?.error;
    throw new ConnectorError(err?.code || (res.status === 404 ? 'no_server' : 'server_error'), err?.message || `HTTP ${res.status}`);
  }
  // Flux NDJSON : une ligne JSON par événement (start, progress…, puis done ou error)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', resumedFrom = 0, result = null;
  const handle = (line) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line);
    if (ev.type === 'start') { resumedFrom = ev.resumed_from || 0; onProgress?.({ received: resumedFrom, total: ev.total, resumedFrom, hashing: false }); }
    else if (ev.type === 'progress') onProgress?.({ received: ev.received, total: ev.total, resumedFrom, hashing: !!ev.hashing });
    else if (ev.type === 'done') result = ev;
    else if (ev.type === 'error') throw new ConnectorError(ev.code || 'server_error', ev.message, ev.detail || '');
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    }
    handle(buffer);
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    throw new ConnectorError(e?.name === 'AbortError' ? 'cancelled' : 'incomplete');
  }
  if (!result) throw new ConnectorError('incomplete');
  return result;
}

/** Début (texte) d'un produit déjà téléchargé, pour l'afficher. */
export async function readProductText(id, maxChars = 20000) {
  await requireServer();
  const res = await fetch(`api/cache/file?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) throw new ConnectorError(res ? 'server_error' : 'no_server', res ? `HTTP ${res.status}` : '');
  return (await res.text()).slice(0, maxChars);
}

/**
 * Compare l'empreinte d'un fichier téléchargé à celle du même fichier source notée dans manifest.json
 * (les données embarquées ont été préparées à partir de ces sources).
 * @returns {{status:'match'|'differs'|'unknown', file:string|null}}
 */
export function integrityAgainstManifest(meta, manifest) {
  const name = String(meta?.file || '').split('/').pop().toLowerCase();
  for (const rec of manifest?.files || []) {
    for (const src of rec.source_files || []) {
      if (String(src.path).split('/').pop().toLowerCase() === name) return { status: src.sha256 === meta.sha256 ? 'match' : 'differs', file: src.path };
    }
  }
  return { status: 'unknown', file: null };
}
