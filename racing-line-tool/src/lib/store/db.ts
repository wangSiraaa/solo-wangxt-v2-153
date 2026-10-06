import type { Project } from '../core/types';

/** 无后端本地持久化：IndexedDB 存取工程（赛道 + 线路 + 车辆参数）。 */

const DB_NAME = 'racing-line-tool';
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

export async function saveProject(p: Project): Promise<void> {
  await tx('readwrite', (s) => s.put(p));
}

export async function loadProject(name: string): Promise<Project | undefined> {
  return tx('readonly', (s) => s.get(name) as IDBRequest<Project | undefined>);
}

export async function listProjects(): Promise<string[]> {
  const keys = await tx('readonly', (s) => s.getAllKeys());
  return keys.map(String).sort();
}

export async function deleteProject(name: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(name));
}
