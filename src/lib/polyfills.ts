/**
 * Globals que `youtubei.js` espera y que Hermes / React Native no traen.
 *
 * El build de RN de la librería (dist/src/platform/react-native.js) lee estos
 * globals al importarse, así que este módulo TIENE que evaluarse antes que él.
 * Por eso `src/youtube/innertube.ts` lo importa en su primera línea y el layout
 * raíz lo importa antes que nada.
 *
 * Concretamente la librería usa: crypto.getRandomValues, crypto.randomUUID,
 * fetch/Request/Response/Headers, FormData, File, ReadableStream, CustomEvent
 * y globalThis.mmkvStorage.
 */

import 'react-native-get-random-values'; // crypto.getRandomValues
import 'react-native-url-polyfill/auto'; // URL + URLSearchParams (el de RN viene incompleto)
import 'text-encoding-polyfill'; // TextEncoder/TextDecoder, que necesita @bufbuild/protobuf
import 'event-target-polyfill'; // EventTarget + Event

import * as Crypto from 'expo-crypto';
import { ReadableStream } from 'web-streams-polyfill';

const g = globalThis as any;

/* ReadableStream: la usa el pipeline de descarga interno de la librería. */
if (typeof g.ReadableStream !== 'function') {
  g.ReadableStream = ReadableStream;
}

/* CustomEvent: RN trae Event vía el polyfill de EventTarget, pero no CustomEvent. */
if (typeof g.CustomEvent !== 'function') {
  class CustomEventPolyfill<T = unknown> extends g.Event {
    readonly detail: T;
    constructor(type: string, options?: { detail?: T; bubbles?: boolean; cancelable?: boolean }) {
      super(type, options);
      this.detail = options?.detail as T;
    }
  }
  g.CustomEvent = CustomEventPolyfill;
}

/* randomUUID no existe en Hermes; expo-crypto lo resuelve de forma nativa. */
if (typeof g.crypto !== 'object' || g.crypto === null) g.crypto = {};
if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = () => Crypto.randomUUID();
}

/* `File` normalmente lo define RN sobre Blob, pero lo cubrimos por si acaso. */
if (typeof g.File !== 'function' && typeof g.Blob === 'function') {
  class FilePolyfill extends g.Blob {
    name: string;
    lastModified: number;
    constructor(parts: unknown[], name: string, options?: { lastModified?: number }) {
      super(parts, options);
      this.name = name;
      this.lastModified = options?.lastModified ?? 0;
    }
  }
  g.File = FilePolyfill;
}

/**
 * El build de RN busca `globalThis.mmkvStorage` para su caché de sesión.
 * No queremos arrastrar react-native-mmkv (es una dependencia nativa más) sólo
 * para esto, así que le damos un almacén en memoria con la misma superficie.
 * La sesión se regenera en cada arranque, que para este uso es irrelevante.
 */
if (!g.mmkvStorage) {
  const mem = new Map<string, unknown>();
  g.mmkvStorage = {
    set: (key: string, value: unknown) => void mem.set(key, value),
    getString: (key: string) => mem.get(key) as string | undefined,
    getNumber: (key: string) => mem.get(key) as number | undefined,
    getBoolean: (key: string) => mem.get(key) as boolean | undefined,
    getBuffer: (key: string) => mem.get(key) as ArrayBuffer | undefined,
    contains: (key: string) => mem.has(key),
    delete: (key: string) => void mem.delete(key),
    getAllKeys: () => Array.from(mem.keys()),
    clearAll: () => mem.clear(),
  };
}

export {};
