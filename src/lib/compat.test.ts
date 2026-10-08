import { describe, expect, it, vi } from 'vitest';
import { generarUuid, mensajeDeError, pedirPersistencia, registrarServiceWorker } from './compat';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Contexto no seguro: solo getRandomValues, sin randomUUID.
const sinRandomUuid = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };

describe('generarUuid', () => {
  it('sin crypto.randomUUID genera un UUID v4 válido', () => {
    expect(generarUuid(sinRandomUuid)).toMatch(UUID_V4);
  });
  it('el respaldo no repite valores', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generarUuid(sinRandomUuid)));
    expect(ids.size).toBe(2000);
  });
  it('fija bits de versión y variante aunque los bytes aleatorios sean extremos', () => {
    for (const byte of [0x00, 0xff]) {
      const c = { getRandomValues: <T extends ArrayBufferView>(a: T) => (new Uint8Array(a.buffer).fill(byte), a) };
      expect(generarUuid(c)).toMatch(UUID_V4);
    }
  });
  it('usa randomUUID cuando existe', () => {
    const c = { randomUUID: () => 'fijo' as `${string}-${string}-${string}-${string}-${string}`, getRandomValues: vi.fn() };
    expect(generarUuid(c as never)).toBe('fijo');
    expect(c.getRandomValues).not.toHaveBeenCalled();
  });
  it('el valor por defecto funciona en el entorno actual', () => {
    expect(generarUuid()).toMatch(UUID_V4);
  });
});

describe('pedirPersistencia', () => {
  it('devuelve null si navigator.storage no existe', async () => {
    expect(await pedirPersistencia(undefined)).toBeNull();
  });
  it('devuelve null si storage no tiene persist', async () => {
    expect(await pedirPersistencia({} as StorageManager)).toBeNull();
  });
  it('devuelve el resultado de persist', async () => {
    expect(await pedirPersistencia({ persist: async () => true })).toBe(true);
    expect(await pedirPersistencia({ persist: async () => false })).toBe(false);
  });
  it('si persist falla no lanza', async () => {
    const fallo = {
      persist: async () => {
        throw new Error('no permitido');
      },
    };
    expect(await pedirPersistencia(fallo)).toBe(false);
  });
});

describe('registrarServiceWorker', () => {
  it('no hace nada si no existe serviceWorker', () => {
    const registrar = vi.fn();
    vi.stubGlobal('navigator', {});
    registrarServiceWorker(registrar);
    expect(registrar).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('registra si existe y no lanza si falla', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = vi.fn();
    registrarServiceWorker(ok);
    expect(ok).toHaveBeenCalled();
    expect(() =>
      registrarServiceWorker(() => {
        throw new Error('x');
      }),
    ).not.toThrow();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('mensajeDeError', () => {
  it('extrae texto de distintos tipos', () => {
    expect(mensajeDeError(new Error('boom'))).toBe('boom');
    expect(mensajeDeError('texto')).toBe('texto');
    expect(mensajeDeError(42)).toBe('error desconocido');
  });
});
