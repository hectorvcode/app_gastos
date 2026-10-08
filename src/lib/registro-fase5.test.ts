import { describe, expect, it } from 'vitest';
import type { Foto, Gasto } from '../types';
import type { FotoProcesada } from './fotos';
import type { Key } from './money';
import { SesionRegistro } from './registro';

const foto = (): FotoProcesada => ({ blob: new Blob([new Uint8Array(100)]), miniatura: new Blob([new Uint8Array(10)]), ancho: 1000, alto: 4000 });

function crear() {
  const gastos = new Map<string, Gasto>();
  const fotos = new Map<string, Foto>();
  let n = 0;
  const sesion = new SesionRegistro(
    'COP',
    {
      add: async (g, f) => {
        gastos.set(g.id, g);
        if (f) fotos.set(f.id, f);
      },
      delete: async (id) => {
        const g = gastos.get(id);
        gastos.delete(id);
        if (g?.fotoId) fotos.delete(g.fotoId);
      },
    },
    () => new Date(2026, 9, 8, 10, 0),
    () => `id-${++n}`,
  );
  return { sesion, gastos, fotos };
}
const teclear = (s: SesionRegistro, digitos: string) => [...digitos].forEach((d) => s.pulsar(d as Key));

describe('foto pendiente en Registrar', () => {
  it('se guarda con el siguiente gasto (mismo id en gasto y foto) y luego el chip se limpia', async () => {
    const { sesion, gastos, fotos } = crear();
    sesion.ponerFoto(foto());
    teclear(sesion, '45000');
    const r = await sesion.guardar('comida');
    expect(r.ok).toBe(true);
    const g = [...gastos.values()][0]!;
    expect(g.fotoId).not.toBeNull();
    expect(fotos.get(g.fotoId!)).toMatchObject({ ancho: 1000, alto: 4000 });
    expect(sesion.foto).toBeNull();
    // El siguiente gasto ya no lleva foto.
    teclear(sesion, '1000');
    await sesion.guardar('otros');
    expect([...gastos.values()][1]?.fotoId).toBeNull();
    expect(fotos.size).toBe(1);
  });
  it('sin foto el gasto se guarda igual que antes (fotoId null)', async () => {
    const { sesion, gastos, fotos } = crear();
    teclear(sesion, '500');
    await sesion.guardar('comida');
    expect([...gastos.values()][0]?.fotoId).toBeNull();
    expect(fotos.size).toBe(0);
  });
  it('con monto 0 no guarda y la foto sigue pendiente', async () => {
    const { sesion, gastos, fotos } = crear();
    const f = foto();
    sesion.ponerFoto(f);
    expect((await sesion.guardar('comida')).ok).toBe(false);
    expect(gastos.size).toBe(0);
    expect(fotos.size).toBe(0);
    expect(sesion.foto).toBe(f);
  });
  it('si guardar falla, la foto, el monto y la nota siguen pendientes', async () => {
    const f = foto();
    const sesion = new SesionRegistro('COP', {
      add: async () => {
        throw new Error('disco lleno');
      },
      delete: async () => {},
    });
    sesion.ponerFoto(f);
    sesion.ponerNota('recibo largo');
    teclear(sesion, '500');
    await expect(sesion.guardar('comida')).rejects.toThrow('disco lleno');
    expect(sesion.foto).toBe(f);
    expect(sesion.nota).toBe('recibo largo');
    expect(sesion.entry).toBe('500');
  });
  it('se puede reemplazar y quitar antes de guardar', async () => {
    const { sesion, gastos } = crear();
    const a = foto();
    const b = foto();
    sesion.ponerFoto(a);
    sesion.ponerFoto(b);
    expect(sesion.foto).toBe(b);
    sesion.ponerFoto(null);
    teclear(sesion, '700');
    await sesion.guardar('comida');
    expect([...gastos.values()][0]?.fotoId).toBeNull();
  });
  it('Deshacer elimina el gasto y también su foto', async () => {
    const { sesion, gastos, fotos } = crear();
    sesion.ponerFoto(foto());
    teclear(sesion, '45000');
    await sesion.guardar('comida');
    expect(fotos.size).toBe(1);
    await sesion.deshacer();
    expect(gastos.size).toBe(0);
    expect(fotos.size).toBe(0);
  });
});
