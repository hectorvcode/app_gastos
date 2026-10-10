import { describe, expect, it } from 'vitest';
import {
  cargarRecordatorio,
  cerrarRecordatorio,
  CLAVE_RECORDATORIO_CERRADO,
  CLAVE_ULTIMO_RESPALDO,
  evaluarRecordatorio,
  guardarUltimoRespaldo,
  leerUltimoRespaldo,
  textoRecordatorio,
  type UltimoRespaldo,
} from './recordatorio';

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date(2026, 9, 20, 9, 0, 0);
const hace = (ms: number): UltimoRespaldo => ({ fecha: new Date(AHORA.getTime() - ms).toISOString(), gastos: 10, fotos: 2 });

describe('recordatorio de respaldo', () => {
  it('no aparece si no hay gastos, aunque nunca se haya respaldado', () => {
    expect(evaluarRecordatorio({ gastos: 0, ultimo: null, cerradoEl: null }, AHORA).mostrar).toBe(false);
  });

  it('aparece si hay gastos y nunca hubo un respaldo', () => {
    const r = evaluarRecordatorio({ gastos: 1, ultimo: null, cerradoEl: null }, AHORA);
    expect(r).toEqual({ mostrar: true, dias: null });
    expect(textoRecordatorio(r.dias)).toBe('Aún no has respaldado tus gastos');
  });

  it('no aparece con un respaldo de hace menos de 7 días', () => {
    expect(evaluarRecordatorio({ gastos: 5, ultimo: hace(0), cerradoEl: null }, AHORA).mostrar).toBe(false);
    expect(evaluarRecordatorio({ gastos: 5, ultimo: hace(3 * DIA), cerradoEl: null }, AHORA).mostrar).toBe(false);
    expect(evaluarRecordatorio({ gastos: 5, ultimo: hace(7 * DIA), cerradoEl: null }, AHORA).mostrar).toBe(false); // 7 justos todavía no
  });

  it('aparece pasados los 7 días, diciendo cuántos', () => {
    const r = evaluarRecordatorio({ gastos: 5, ultimo: hace(7 * DIA + 1000), cerradoEl: null }, AHORA);
    expect(r.mostrar).toBe(true);
    expect(r.dias).toBe(7);
    const r2 = evaluarRecordatorio({ gastos: 5, ultimo: hace(12 * DIA + 5 * 3600_000), cerradoEl: null }, AHORA);
    expect(r2.dias).toBe(12);
    expect(textoRecordatorio(r2.dias)).toBe('Hace 12 días que no respaldas tus gastos');
  });

  it('al cerrarlo no reaparece el mismo día, pero sí al día siguiente', async () => {
    const ajustes = new Map<string, unknown>();
    const repo = {
      get: async (k: string) => ajustes.get(k),
      set: async (k: string, v: unknown) => void ajustes.set(k, v),
    };
    const contar = async (): Promise<number> => 40;
    expect((await cargarRecordatorio(repo, contar, AHORA)).mostrar).toBe(true);

    await cerrarRecordatorio(repo, AHORA);
    expect(ajustes.get(CLAVE_RECORDATORIO_CERRADO)).toBe('2026-10-20');
    expect((await cargarRecordatorio(repo, contar, AHORA)).mostrar).toBe(false);
    const tarde = new Date(2026, 9, 20, 23, 59, 0);
    expect((await cargarRecordatorio(repo, contar, tarde)).mostrar).toBe(false);

    const manana = new Date(2026, 9, 21, 0, 1, 0);
    expect((await cargarRecordatorio(repo, contar, manana)).mostrar).toBe(true);
  });

  it('crear un respaldo lo apaga, y vuelve a los 7 días', async () => {
    const ajustes = new Map<string, unknown>();
    const repo = {
      get: async (k: string) => ajustes.get(k),
      set: async (k: string, v: unknown) => void ajustes.set(k, v),
    };
    const contar = async (): Promise<number> => 40;
    await guardarUltimoRespaldo(repo, { fecha: AHORA.toISOString(), gastos: 40, fotos: 3 });
    expect(ajustes.get(CLAVE_ULTIMO_RESPALDO)).toEqual({ fecha: AHORA.toISOString(), gastos: 40, fotos: 3 });
    expect((await cargarRecordatorio(repo, contar, AHORA)).mostrar).toBe(false);
    const en8Dias = new Date(AHORA.getTime() + 8 * DIA);
    const r = await cargarRecordatorio(repo, contar, en8Dias);
    expect(r.mostrar).toBe(true);
    expect(r.dias).toBe(8);
  });

  it('un ajuste dañado cuenta como "nunca respaldado"', () => {
    expect(leerUltimoRespaldo(undefined)).toBeNull();
    expect(leerUltimoRespaldo('ayer')).toBeNull();
    expect(leerUltimoRespaldo({ fecha: 'no-es-fecha' })).toBeNull();
    expect(leerUltimoRespaldo({ fecha: '2026-10-01T00:00:00.000Z' })).toEqual({
      fecha: '2026-10-01T00:00:00.000Z',
      gastos: 0,
      fotos: 0,
    });
  });
});
