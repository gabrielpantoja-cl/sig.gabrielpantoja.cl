/**
 * Guardado de las capas KML del usuario en SU navegador (IndexedDB).
 *
 * Las capas siguen sin salir del dispositivo: no hay servidor, cuenta ni
 * base de datos del SIG involucrados. Lo guardado sobrevive a recargar o
 * cerrar la pestaña, pero es de este navegador en este equipo — borrar los
 * datos del sitio o una ventana privada lo pierden. Cada capa es un registro
 * propio (clave `id`) para que cambiar una no reescriba las demás.
 *
 * Todo falla en silencio hacia el llamador como promesa rechazada: sin
 * IndexedDB (modo privado estricto, cuota agotada) el SIG funciona igual,
 * solo que sin recordar las capas.
 */

import { restoreKmlLayer, type KmlLayer } from '@/lib/kml';

const DB_NAME = 'sig-capas-usuario';
const STORE = 'kml';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB no abrió'));
    req.onblocked = () => reject(new Error('IndexedDB bloqueado'));
  });
  // Un fallo no queda cacheado: el próximo intento vuelve a abrir.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB falló'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB abortó'));
      }),
  );
}

/** Capas guardadas, en el orden en que se subieron. Descarta las corruptas. */
export async function loadStoredKml(): Promise<KmlLayer[]> {
  const raw = await run<unknown[]>('readonly', (s) => s.getAll());
  return raw
    .map(restoreKmlLayer)
    .filter((l): l is KmlLayer => l !== null)
    .sort((a, b) => a.subidaEn - b.subidaEn);
}

export function putStoredKml(layer: KmlLayer): Promise<unknown> {
  // `restaurada` describe esta sesión, no la capa: no se guarda.
  const { restaurada: _omit, ...record } = layer;
  void _omit;
  return run('readwrite', (s) => s.put(record));
}

export function deleteStoredKml(id: string): Promise<unknown> {
  return run('readwrite', (s) => s.delete(id));
}
