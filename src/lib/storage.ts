import type { TractionProject } from './types';

const DB_NAME = 'offline-racing-line-tool';
const DB_VERSION = 1;
const STORE = 'projects';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

export async function listProjects(): Promise<TractionProject[]> {
  const db = await openDatabase();
  try {
    const values = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return (values as TractionProject[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function saveProject(project: TractionProject): Promise<TractionProject> {
  const stored: TractionProject = { ...project, updatedAt: Date.now() };
  const db = await openDatabase();
  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(stored));
    return stored;
  } finally {
    db.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

export function downloadProject(project: TractionProject): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name || 'racing-line-project'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importProjectFile(file: File): Promise<TractionProject> {
  const text = await file.text();
  const parsed = JSON.parse(text) as TractionProject;
  if (!parsed.id || !Array.isArray(parsed.trackPoints) || !Array.isArray(parsed.routePoints)) {
    throw new Error('文件不是有效的工程 JSON');
  }
  return {
    ...parsed,
    vehicle: { ...parsed.vehicle },
    trackPoints: parsed.trackPoints.map((p) => ({ ...p })),
    routePoints: parsed.routePoints.map((p) => ({ ...p }))
  };
}
