const DATABASE_NAME = "playalong3d-library";
const STORE_NAME = "midi-files";
const DATABASE_VERSION = 1;

interface StoredMidiRecord {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  savedAt: number;
  data: ArrayBuffer;
}

export interface StoredMidiSummary {
  id: string;
  name: string;
  size: number;
  savedAt: number;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function storedMidiId(file: Pick<File, "name" | "size" | "lastModified">) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function saveStoredMidiFile(file: File) {
  const database = await openDatabase();
  try {
    const record: StoredMidiRecord = {
      id: storedMidiId(file),
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      savedAt: Date.now(),
      data: await file.arrayBuffer(),
    };
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionComplete(transaction);
    return {
      id: record.id,
      name: record.name,
      size: record.size,
      savedAt: record.savedAt,
    } satisfies StoredMidiSummary;
  } finally {
    database.close();
  }
}

export async function listStoredMidiFiles() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const records = await requestResult(
      transaction.objectStore(STORE_NAME).getAll() as IDBRequest<
        StoredMidiRecord[]
      >,
    );
    return records
      .map(({ id, name, size, savedAt }) => ({ id, name, size, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt) satisfies StoredMidiSummary[];
  } finally {
    database.close();
  }
}

export async function loadStoredMidiFile(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = await requestResult(
      transaction.objectStore(STORE_NAME).get(id) as IDBRequest<
        StoredMidiRecord | undefined
      >,
    );
    if (!record) throw new Error("Stored MIDI file not found");
    return new File([record.data], record.name, {
      type: "audio/midi",
      lastModified: record.lastModified,
    });
  } finally {
    database.close();
  }
}

export async function clearStoredMidiFiles() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}
