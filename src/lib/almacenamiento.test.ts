import { describe, expect, it, vi } from 'vitest';
import {
  leerAlmacenamiento,
  NO_DISPONIBLE,
  pedirAlmacenamientoPersistente,
  textoConteos,
  textoEspacio,
  textoPersistencia,
} from './almacenamiento';

describe('almacenamiento sin APIs disponibles (p. ej. por HTTP)', () => {
  it('sin navigator.storage no lanza y todo queda "no disponible"', async () => {
    const e = await leerAlmacenamiento(undefined);
    expect(e).toEqual({ usado: null, cuota: null, persistente: null, puedePedir: false });
    expect(textoEspacio(e)).toBe('No disponible en esta conexión');
    expect(textoPersistencia(e.persistente)).toBe('No disponible en esta conexión');
    expect(NO_DISPONIBLE).toBe('No disponible en esta conexión');
  });

  it('un storage vacío tampoco lanza', async () => {
    const e = await leerAlmacenamiento({});
    expect(e.usado).toBeNull();
    expect(e.puedePedir).toBe(false);
  });

  it('si estimate o persisted fallan, se queda en "no disponible" sin lanzar', async () => {
    const e = await leerAlmacenamiento({
      estimate: () => Promise.reject(new Error('bloqueado')),
      persisted: () => Promise.reject(new Error('bloqueado')),
    });
    expect(e.usado).toBeNull();
    expect(e.persistente).toBeNull();
  });

  it('pedir persistencia sin la API devuelve null y no lanza', async () => {
    expect(await pedirAlmacenamientoPersistente(undefined)).toBeNull();
    expect(await pedirAlmacenamientoPersistente({})).toBeNull();
  });
});

describe('almacenamiento con las APIs disponibles', () => {
  it('muestra usado, cuota y lo que queda', async () => {
    const e = await leerAlmacenamiento({
      estimate: async () => ({ usage: 12.3 * 1024 * 1024, quota: 1.2 * 1024 ** 3 }),
      persisted: async () => false,
      persist: async () => true,
    });
    expect(e.persistente).toBe(false);
    expect(e.puedePedir).toBe(true);
    expect(textoEspacio(e)).toBe('12.3 MB usados de 1.2 GB · quedan 1.2 GB');
    expect(textoPersistencia(false)).toContain('No persistente');
    expect(textoPersistencia(true)).toContain('Persistente');
  });

  it('pedir persistencia llama a persist() y devuelve su resultado', async () => {
    const persist = vi.fn(async () => true);
    expect(await pedirAlmacenamientoPersistente({ persist })).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
    expect(await pedirAlmacenamientoPersistente({ persist: async () => false })).toBe(false);
  });

  it('el texto de datos cuenta gastos, fotos y su peso', () => {
    expect(textoConteos(2000, 300, 120 * 1024 * 1024)).toBe('2000 gastos · 300 fotos (unos 120.0 MB)');
    expect(textoConteos(1, 0, 0)).toBe('1 gasto · 0 fotos');
    expect(textoConteos(0, 1, 2048)).toBe('0 gastos · 1 foto (unos 2 KB)');
  });
});
