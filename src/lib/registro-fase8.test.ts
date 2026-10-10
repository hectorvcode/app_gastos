import { describe, expect, it } from 'vitest';
import type { Gasto } from '../types';
import { guardarBorrador, leerBorrador, validarBorrador, type RepoBorrador } from './borrador';
import type { Key } from './money';
import {
  aplicarTeclaFisica,
  guardadoRapidoActivo,
  MSG_FALTA_CATEGORIA,
  MSG_FALTA_MONTO,
  SesionRegistro,
  textoBotonGuardar,
} from './registro';

function crear(moneda = 'COP') {
  const guardados = new Map<string, Gasto>();
  let fallar = false;
  let n = 0;
  const sesion = new SesionRegistro(
    moneda,
    {
      add: async (g) => {
        if (fallar) throw new Error('disco lleno');
        guardados.set(g.id, g);
      },
      delete: async (id) => void guardados.delete(id),
    },
    () => new Date(2026, 9, 7, 13, 42),
    () => `id-${++n}`,
  );
  return { sesion, guardados, fallar: (v: boolean) => (fallar = v) };
}

const escribir = (s: SesionRegistro, digitos: string) => [...digitos].forEach((d) => s.pulsar(d as Key));

describe('selección de categoría', () => {
  it('tocar una categoría la selecciona sin guardar nada', async () => {
    const { sesion, guardados } = crear();
    escribir(sesion, '45000');
    expect(await sesion.tocarCategoria('comida')).toBeNull();
    expect(sesion.categoriaId).toBe('comida');
    expect(guardados.size).toBe(0);
    expect(sesion.entry).toBe('45000');
  });

  it('tocar otra cambia la selección y tocar la misma la quita', async () => {
    const { sesion } = crear();
    await sesion.tocarCategoria('comida');
    await sesion.tocarCategoria('hogar');
    expect(sesion.categoriaId).toBe('hogar');
    await sesion.tocarCategoria('hogar');
    expect(sesion.categoriaId).toBeNull();
  });
});

describe('botón Guardar', () => {
  it('el texto resume monto, moneda y categoría con el formato de la moneda', () => {
    expect(textoBotonGuardar('45000', 'COP', 'Comida')).toBe('Guardar 45.000 COP · Comida');
    expect(textoBotonGuardar('12.5', 'USD', 'Compras')).toBe('Guardar 12,50 USD · Compras');
    expect(textoBotonGuardar('', 'COP', null)).toBe('Guardar');
    expect(textoBotonGuardar('45000', 'COP', null)).toBe('Guardar 45.000 COP');
    expect(textoBotonGuardar('', 'COP', 'Comida')).toBe('Guardar · Comida');
  });

  it('sin monto dice "Escribe el monto" (aunque tampoco haya categoría) y no guarda', async () => {
    const { sesion, guardados } = crear();
    expect(sesion.faltante()).toEqual({ falta: 'monto', mensaje: MSG_FALTA_MONTO });
    await sesion.tocarCategoria('comida');
    expect(sesion.faltante()?.mensaje).toBe('Escribe el monto');
    expect((await sesion.guardarSeleccion()).ok).toBe(false);
    expect(guardados.size).toBe(0);
    expect(sesion.categoriaId).toBe('comida'); // la selección sigue ahí
  });

  it('con monto pero sin categoría dice "Elige una categoría" y no guarda', async () => {
    const { sesion, guardados } = crear();
    escribir(sesion, '45000');
    expect(sesion.faltante()).toEqual({ falta: 'categoria', mensaje: MSG_FALTA_CATEGORIA });
    expect(sesion.faltante()?.mensaje).toBe('Elige una categoría');
    expect((await sesion.guardarSeleccion()).ok).toBe(false);
    expect(guardados.size).toBe(0);
    expect(sesion.entry).toBe('45000');
  });

  it('con monto y categoría guarda y reinicia monto y selección; la moneda y la cuenta se conservan', async () => {
    const { sesion, guardados } = crear('USD');
    sesion.cuentaId = 'hogar';
    sesion.elegirDiasAtras(1);
    sesion.ponerNota('Taxi');
    escribir(sesion, '12');
    await sesion.tocarCategoria('transporte');
    expect(sesion.faltante()).toBeNull();
    const r = await sesion.guardarSeleccion();
    expect(r.ok).toBe(true);
    const [g] = [...guardados.values()];
    expect(g).toMatchObject({ monto: 12, moneda: 'USD', categoriaId: 'transporte', cuentaId: 'hogar', nota: 'Taxi' });
    expect(sesion.entry).toBe('');
    expect(sesion.categoriaId).toBeNull();
    expect(sesion.nota).toBe('');
    expect(sesion.moneda).toBe('USD');
    expect(sesion.cuentaId).toBe('hogar');
    expect(sesion.fechaActual).toBe('2026-10-06'); // la fecha elegida se mantiene
    expect(sesion.faltante()?.falta).toBe('monto');
  });

  it('dos toques rápidos en Guardar crean un solo gasto', async () => {
    const { sesion, guardados } = crear();
    escribir(sesion, '45000');
    await sesion.tocarCategoria('comida');
    const [a, b] = await Promise.all([sesion.guardarSeleccion(), sesion.guardarSeleccion()]);
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(guardados.size).toBe(1);
  });

  it('si falla la base de datos conserva monto, nota y categoría y propaga el error', async () => {
    const { sesion, guardados, fallar } = crear();
    escribir(sesion, '45000');
    sesion.ponerNota('Almuerzo');
    await sesion.tocarCategoria('comida');
    fallar(true);
    await expect(sesion.guardarSeleccion()).rejects.toThrow('disco lleno');
    expect(sesion.entry).toBe('45000');
    expect(sesion.nota).toBe('Almuerzo');
    expect(sesion.categoriaId).toBe('comida');
    fallar(false);
    expect((await sesion.guardarSeleccion()).ok).toBe(true);
    expect(guardados.size).toBe(1);
  });

  it('Deshacer borra el gasto guardado con el botón', async () => {
    const { sesion, guardados } = crear();
    escribir(sesion, '100');
    await sesion.tocarCategoria('comida');
    await sesion.guardarSeleccion();
    await sesion.deshacer();
    expect(guardados.size).toBe(0);
  });
});

describe('cambio de cuenta con una categoría seleccionada', () => {
  it('se deselecciona si la nueva cuenta no la muestra y devuelve cuál era', async () => {
    const { sesion } = crear();
    await sesion.tocarCategoria('mercado');
    expect(sesion.cambiarCuenta('negocio', ['comida', 'otros'])).toBe('mercado');
    expect(sesion.cuentaId).toBe('negocio');
    expect(sesion.categoriaId).toBeNull();
  });

  it('se conserva si la nueva cuenta también la muestra', async () => {
    const { sesion } = crear();
    await sesion.tocarCategoria('comida');
    expect(sesion.cambiarCuenta('negocio', ['comida', 'otros'])).toBeNull();
    expect(sesion.categoriaId).toBe('comida');
  });

  it('quitarSiNoVisible cubre una categoría ocultada desde Ajustes', async () => {
    const { sesion } = crear();
    await sesion.tocarCategoria('ocio');
    expect(sesion.quitarSiNoVisible(['comida'])).toBe('ocio');
    expect(sesion.categoriaId).toBeNull();
    expect(sesion.quitarSiNoVisible(['comida'])).toBeNull();
  });
});

describe('teclado físico: Enter y Escape', () => {
  it('Enter pide Guardar y guarda si hay monto y categoría', async () => {
    const { sesion, guardados } = crear();
    escribir(sesion, '45000');
    await sesion.tocarCategoria('comida');
    expect(aplicarTeclaFisica(sesion, 'Enter')).toBe('guardar');
    expect((await sesion.guardarSeleccion()).ok).toBe(true);
    expect(guardados.size).toBe(1);
  });

  it('Enter con algo pendiente muestra el mismo mensaje que el botón', () => {
    const { sesion } = crear();
    expect(aplicarTeclaFisica(sesion, 'Enter')).toBe('guardar');
    expect(sesion.faltante()?.mensaje).toBe('Escribe el monto');
    escribir(sesion, '10');
    expect(sesion.faltante()?.mensaje).toBe('Elige una categoría');
  });

  it('Escape deselecciona la categoría; sin selección no se consume', async () => {
    const { sesion } = crear();
    expect(aplicarTeclaFisica(sesion, 'Escape')).toBeNull();
    await sesion.tocarCategoria('comida');
    expect(aplicarTeclaFisica(sesion, 'Escape')).toBe('deseleccionar');
    expect(sesion.categoriaId).toBeNull();
  });

  it('Escape no toca el monto', async () => {
    const { sesion } = crear();
    escribir(sesion, '45000');
    await sesion.tocarCategoria('comida');
    aplicarTeclaFisica(sesion, 'Escape');
    expect(sesion.entry).toBe('45000');
  });
});

describe('guardado rápido', () => {
  it('solo se activa con true (desactivado por defecto)', () => {
    expect(guardadoRapidoActivo(undefined)).toBe(false);
    expect(guardadoRapidoActivo(false)).toBe(false);
    expect(guardadoRapidoActivo('si')).toBe(false);
    expect(guardadoRapidoActivo(true)).toBe(true);
  });

  it('activado: tocar la categoría guarda al instante y no deja selección', async () => {
    const { sesion, guardados } = crear();
    sesion.guardadoRapido = true;
    escribir(sesion, '45000');
    const r = await sesion.tocarCategoria('comida');
    expect(r?.ok).toBe(true);
    expect([...guardados.values()][0]).toMatchObject({ monto: 45000, categoriaId: 'comida' });
    expect(sesion.categoriaId).toBeNull();
    expect(sesion.entry).toBe('');
  });

  it('activado: con monto 0 no guarda (la pantalla hace vibrar el monto)', async () => {
    const { sesion, guardados } = crear();
    sesion.guardadoRapido = true;
    expect((await sesion.tocarCategoria('comida'))?.ok).toBe(false);
    expect(guardados.size).toBe(0);
  });

  it('activado: Enter se ignora y no guarda', async () => {
    const { sesion, guardados } = crear();
    sesion.guardadoRapido = true;
    escribir(sesion, '45000');
    expect(aplicarTeclaFisica(sesion, 'Enter')).toBe('ignorada');
    expect(guardados.size).toBe(0);
  });

  it('desactivado: tocar la categoría no guarda', async () => {
    const { sesion, guardados } = crear();
    sesion.guardadoRapido = false;
    escribir(sesion, '45000');
    expect(await sesion.tocarCategoria('comida')).toBeNull();
    expect(guardados.size).toBe(0);
  });
});

describe('la categoría en el borrador', () => {
  const repoEnMemoria = (): { repo: RepoBorrador; datos: Map<string, unknown> } => {
    const datos = new Map<string, unknown>();
    return {
      datos,
      repo: {
        get: async (k) => datos.get(k),
        set: async (k, v) => void datos.set(k, v),
        delete: async (k) => void datos.delete(k),
      },
    };
  };
  const T0 = Date.UTC(2026, 9, 8, 15, 0, 0);
  const ids = () => ['comida', 'transporte'];

  it('la instantánea incluye la categoría seleccionada', async () => {
    const { sesion } = crear();
    expect(sesion.instantanea().categoriaId).toBeNull();
    await sesion.tocarCategoria('comida');
    expect(sesion.instantanea().categoriaId).toBe('comida');
  });

  it('se guarda en el borrador y se restaura en una sesión nueva', async () => {
    const { repo } = repoEnMemoria();
    const a = crear().sesion;
    escribir(a, '45000');
    await a.tocarCategoria('comida');
    await guardarBorrador(repo, a.instantanea(), true, T0);

    const rec = await leerBorrador(repo, T0 + 1000);
    expect(rec?.borrador.categoriaId).toBe('comida');
    const b = crear().sesion;
    b.restaurar(rec!.borrador, ['COP'], ['personal'], ids);
    expect(b.entry).toBe('45000');
    expect(b.categoriaId).toBe('comida');
  });

  it('no restaura una categoría que la cuenta ya no muestra', async () => {
    const a = crear().sesion;
    escribir(a, '100');
    await a.tocarCategoria('mercado');
    const b = crear().sesion;
    b.restaurar({ ...a.instantanea() }, ['COP'], ['personal'], ids);
    expect(b.categoriaId).toBeNull();
    expect(b.entry).toBe('100');
  });

  it('con guardado rápido no restaura ninguna selección', async () => {
    const a = crear().sesion;
    await a.tocarCategoria('comida');
    const b = crear().sesion;
    b.guardadoRapido = true;
    b.restaurar(a.instantanea(), ['COP'], ['personal'], ids);
    expect(b.categoriaId).toBeNull();
  });

  it('un borrador anterior a la Fase 8 (sin categoría) sigue siendo válido', () => {
    const viejo = {
      entry: '500',
      moneda: 'COP',
      fecha: null,
      cuentaId: 'personal',
      nota: '',
      esperandoFoto: false,
      guardadoEn: T0,
    };
    expect(validarBorrador(viejo)?.categoriaId).toBeNull();
    expect(validarBorrador({ ...viejo, categoriaId: 7 })).toBeNull();
    expect(validarBorrador({ ...viejo, categoriaId: 'comida' })?.categoriaId).toBe('comida');
  });
});
