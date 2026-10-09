import { describe, expect, it } from 'vitest';
import type { Categoria, Cuenta, Gasto } from '../types';
import {
  borrarCategoria,
  categoriasDeRegistrar,
  categoriasVisibles,
  crearCategoria,
  editarCategoria,
  EMOJI_CATEGORIA_POR_DEFECTO,
  capturarPrevia,
  deshacerVisibilidad,
  marcaOculta,
  textoOcultaEnCuenta,
  textoOcultaEnTodas,
  idsIniciales,
  idsVisibles,
  MAX_NOMBRE_CATEGORIA,
  MAX_VISIBLES,
  migrarCuentas,
  moverEnCuenta,
  mostrarEnCatalogo,
  mostrarEnCuenta,
  ocultarDelCatalogo,
  ocultarEnCuenta,
  opcionesParaEdicion,
  type EstadoCatalogo,
  type ResultadoCatalogo,
} from './categorias';
import { crearCuenta } from './cuentas';
import { fechaHoraAIso } from './dates';
import { cambioDe, construirFilas, pendienteDeExportar } from './exportar';

const cat = (id: string, orden: number, extra: Partial<Categoria> = {}): Categoria => ({
  id,
  nombre: id[0]!.toUpperCase() + id.slice(1),
  emoji: '📦',
  orden,
  activa: true,
  ...extra,
});

const NOMBRES = ['comida', 'mercado', 'transporte', 'hogar', 'salud', 'ocio', 'compras', 'servicios', 'otros'];
const catalogo = (): Categoria[] => NOMBRES.map((id, i) => cat(id, i));

const cuenta = (id: string, orden: number, categoriaIds?: string[], extra: Partial<Cuenta> = {}): Cuenta => ({
  id,
  nombre: id[0]!.toUpperCase() + id.slice(1),
  emoji: '📒',
  orden,
  archivada: false,
  ...(categoriaIds ? { categoriaIds } : {}),
  ...extra,
});

const T0 = '2026-10-01T00:00:00.000Z';
const gasto = (p: Partial<Gasto> = {}): Gasto => ({
  id: 'g1',
  fecha: fechaHoraAIso('2026-10-07', '10:00'),
  monto: 1000,
  moneda: 'COP',
  categoriaId: 'comida',
  cuentaId: 'personal',
  nota: '',
  fotoId: null,
  creadoEn: T0,
  editadoEn: T0,
  exportadoEn: null,
  ...p,
});

const estado = (cuentas: Cuenta[], categorias: Categoria[] = catalogo()): EstadoCatalogo => ({ categorias, cuentas });

function ok(r: ResultadoCatalogo): Extract<ResultadoCatalogo, { ok: true }> {
  if (!r.ok) throw new Error(`se esperaba ok y fue error: ${r.error}`);
  return r;
}
function error(r: ResultadoCatalogo): string {
  if (r.ok) throw new Error('se esperaba un error');
  return r.error;
}
const idsDe = (r: Extract<ResultadoCatalogo, { ok: true }>, cuentaId: string): string[] | undefined =>
  r.cuentas.find((c) => c.id === cuentaId)?.categoriaIds;

/** Un catálogo de 12 + 3 extra para probar el límite. */
const catalogoGrande = (): Categoria[] => Array.from({ length: 15 }, (_, i) => cat(`c${i}`, i));

describe('migración de categorías por cuenta', () => {
  it('las cuentas existentes reciben todas las activas en su orden actual (por orden, no por posición)', () => {
    const cats = [cat('b', 1), cat('a', 0), cat('x', 2, { activa: false }), cat('c', 3)];
    const r = migrarCuentas([cuenta('personal', 0), cuenta('hogar', 1)], cats);
    expect(r.map((c) => c.categoriaIds)).toEqual([
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ]);
  });

  it('cada cuenta recibe su propia copia de la lista', () => {
    const [a, b] = migrarCuentas([cuenta('personal', 0), cuenta('hogar', 1)], catalogo());
    a!.categoriaIds!.pop();
    expect(b!.categoriaIds).toHaveLength(9);
  });

  it('no toca las cuentas que ya tienen lista, y es idempotente', () => {
    const propia = cuenta('hogar', 1, ['salud', 'comida']);
    const una = migrarCuentas([cuenta('personal', 0), propia], catalogo());
    expect(una[1]).toBe(propia);
    expect(migrarCuentas(una, catalogo())).toEqual(una);
  });

  it('no pierde ni cambia gastos: todos siguen resolviendo su categoría', () => {
    const gastos = [gasto({ id: 'a', categoriaId: 'salud' }), gasto({ id: 'b', categoriaId: 'otros', cuentaId: 'hogar' })];
    const antes = JSON.stringify(gastos);
    const cuentas = migrarCuentas([cuenta('personal', 0), cuenta('hogar', 1)], catalogo());
    expect(JSON.stringify(gastos)).toBe(antes);
    for (const g of gastos) {
      const c = cuentas.find((x) => x.id === g.cuentaId);
      expect(categoriasVisibles(c, catalogo()).map((x) => x.id)).toContain(g.categoriaId);
    }
  });

  it('una cuenta nueva empieza con todas las activas, hasta 12', () => {
    expect(idsIniciales(catalogo())).toEqual(NOMBRES);
    expect(idsIniciales(catalogoGrande())).toHaveLength(12);
    expect(idsIniciales(catalogoGrande())[11]).toBe('c11');
    const r = crearCuenta([cuenta('personal', 0)], 'Hogar', '🏠', 'hogar', idsIniciales(catalogoGrande()));
    expect(r.ok && r.cuentas.find((c) => c.id === 'hogar')?.categoriaIds).toHaveLength(12);
  });

  it('sin lista (datos anteriores), idsVisibles muestra las iniciales; una lista vacía no deja Registrar sin categorías', () => {
    expect(idsVisibles(cuenta('personal', 0), catalogo())).toEqual(NOMBRES);
    expect(idsVisibles(cuenta('personal', 0, []), catalogo())).toEqual(NOMBRES);
    expect(idsVisibles(undefined, catalogo())).toEqual(NOMBRES);
  });

  it('idsVisibles descarta ids repetidos, inexistentes u ocultos del catálogo', () => {
    const cats = [cat('a', 0), cat('b', 1, { activa: false }), cat('c', 2)];
    expect(idsVisibles(cuenta('p', 0, ['c', 'b', 'zzz', 'a', 'c']), cats)).toEqual(['c', 'a']);
  });
});

describe('máximo 12 y mínimo 1 visibles por cuenta', () => {
  it('mostrar una 13.ª falla con el motivo (no caben en Registrar sin scroll)', () => {
    const cats = catalogoGrande();
    const e = estado([cuenta('personal', 0, idsIniciales(cats))], cats);
    expect(error(mostrarEnCuenta(e, 'personal', 'c12'))).toMatch(/12 categorías.*sin scroll/);
  });

  it('con 11 sí se puede mostrar la 12.ª, al final', () => {
    const cats = catalogoGrande();
    const e = estado([cuenta('personal', 0, cats.slice(0, 11).map((c) => c.id))], cats);
    const r = ok(mostrarEnCuenta(e, 'personal', 'c11'));
    expect(idsDe(r, 'personal')).toHaveLength(12);
    expect(idsDe(r, 'personal')!.at(-1)).toBe('c11');
  });

  it('no se puede ocultar la última categoría visible', () => {
    const e = estado([cuenta('personal', 0, ['comida'])]);
    expect(error(ocultarEnCuenta(e, 'personal', 'comida'))).toMatch(/al menos 1/);
  });

  it('ocultar en una cuenta no la quita de las demás', () => {
    const e = estado([cuenta('personal', 0, ['comida', 'salud']), cuenta('hogar', 1, ['comida', 'salud'])]);
    const r = ok(ocultarEnCuenta(e, 'personal', 'comida'));
    expect(idsDe(r, 'personal')).toEqual(['salud']);
    expect(idsDe(r, 'hogar')).toEqual(['comida', 'salud']);
  });

  it('mostrar una categoría oculta del catálogo se rechaza', () => {
    const cats = catalogo().map((c) => (c.id === 'ocio' ? { ...c, activa: false } : c));
    const e = estado([cuenta('personal', 0, ['comida'])], cats);
    expect(error(mostrarEnCuenta(e, 'personal', 'ocio'))).toMatch(/oculta del catálogo/);
  });

  it('mover cambia el orden solo en esa cuenta y avisa en los extremos', () => {
    const e = estado([cuenta('personal', 0, ['comida', 'salud', 'ocio']), cuenta('hogar', 1, ['comida', 'salud', 'ocio'])]);
    const r = ok(moverEnCuenta(e, 'personal', 'ocio', -1));
    expect(idsDe(r, 'personal')).toEqual(['comida', 'ocio', 'salud']);
    expect(idsDe(r, 'hogar')).toEqual(['comida', 'salud', 'ocio']);
    expect(error(moverEnCuenta(e, 'personal', 'comida', -1))).toMatch(/primera/);
    expect(error(moverEnCuenta(e, 'personal', 'ocio', 1))).toMatch(/última/);
    expect(error(moverEnCuenta(e, 'personal', 'otros', 1))).toMatch(/no está visible/);
  });
});

describe('nombres, emoji y renombrar', () => {
  const base = (): EstadoCatalogo => estado([cuenta('personal', 0, NOMBRES)]);

  it('los nombres son únicos sin distinguir mayúsculas ni espacios de más', () => {
    expect(error(crearCategoria(base(), '  COMIDA ', '🍕', 'n1', 'personal'))).toMatch(/Ya existe/);
    expect(ok(crearCategoria(base(), '  Super   mercado ', '', 'n1', 'personal')).categorias.at(-1)?.nombre).toBe('Super mercado');
  });

  it('también chocan con una categoría oculta del catálogo', () => {
    const cats = catalogo().map((c) => (c.id === 'ocio' ? { ...c, activa: false } : c));
    expect(error(crearCategoria(estado([cuenta('personal', 0, ['comida'])], cats), 'ocio', '', 'n1', 'personal'))).toMatch(/Ya existe/);
  });

  it('admite hasta 20 caracteres y no vacío', () => {
    expect(ok(crearCategoria(base(), 'x'.repeat(MAX_NOMBRE_CATEGORIA), '', 'n1', 'personal')).categorias).toHaveLength(10);
    expect(error(crearCategoria(base(), 'x'.repeat(MAX_NOMBRE_CATEGORIA + 1), '', 'n1', 'personal'))).toMatch(/20 caracteres/);
    expect(error(crearCategoria(base(), '   ', '', 'n1', 'personal'))).toMatch(/Escribe un nombre/);
  });

  it('emoji vacío → 🏷️', () => {
    const r = ok(crearCategoria(base(), 'Mascotas', '  ', 'n1', 'personal'));
    expect(r.categorias.find((c) => c.id === 'n1')?.emoji).toBe(EMOJI_CATEGORIA_POR_DEFECTO);
    expect(EMOJI_CATEGORIA_POR_DEFECTO).toBe('🏷️');
    const e = ok(editarCategoria(base(), 'comida', { emoji: '' }));
    expect(e.categorias.find((c) => c.id === 'comida')?.emoji).toBe('🏷️');
  });

  it('renombrar: puede cambiar mayúsculas de sí misma, pero no tomar el nombre de otra', () => {
    expect(ok(editarCategoria(base(), 'comida', { nombre: 'COMIDA' })).categorias[0]?.nombre).toBe('COMIDA');
    expect(error(editarCategoria(base(), 'comida', { nombre: 'salud' }))).toMatch(/Ya existe/);
    expect(error(editarCategoria(base(), 'nope', { nombre: 'x' }))).toMatch(/ya no existe/);
  });

  it('renombrar solo toca el catálogo: las cuentas quedan iguales y los gastos no se tocan', () => {
    const e = base();
    const g = gasto({ categoriaId: 'comida', exportadoEn: '2026-10-02T00:00:00.000Z' });
    const antes = JSON.stringify(g);
    const r = ok(editarCategoria(e, 'comida', { nombre: 'Restaurantes', emoji: '🍕' }));
    expect(r.cuentas).toBe(e.cuentas);
    expect(r.borradas).toEqual([]);
    expect(JSON.stringify(g)).toBe(antes);
    expect(g.editadoEn).toBe(T0);
    expect(pendienteDeExportar(g)).toBe(false); // no vuelve a salir en "Solo nuevos"
    expect(cambioDe(g)).toBe(cambioDe(JSON.parse(antes) as Gasto));
  });

  it('la exportación usa el nombre actual de la categoría', () => {
    const g = gasto({ categoriaId: 'comida' });
    const r = ok(editarCategoria(estado([cuenta('personal', 0, NOMBRES)]), 'comida', { nombre: 'Restaurantes' }));
    const filas = construirFilas({ gastos: [g], eliminados: [] }, r.categorias, [{ id: 'personal', nombre: 'Personal' }], new Map());
    expect(filas[0]?.categoria).toBe('Restaurantes');
  });
});

describe('ocultar frente a borrar, y efecto en todas las cuentas', () => {
  const dos = (): EstadoCatalogo =>
    estado([cuenta('personal', 0, ['comida', 'salud', 'ocio']), cuenta('hogar', 1, ['salud', 'comida'])]);

  it('ocultar del catálogo la quita de todas las cuentas, pero la categoría sigue existiendo para los gastos', () => {
    const r = ok(ocultarDelCatalogo(dos(), 'comida'));
    expect(idsDe(r, 'personal')).toEqual(['salud', 'ocio']);
    expect(idsDe(r, 'hogar')).toEqual(['salud']);
    expect(r.borradas).toEqual([]);
    const oculta = r.categorias.find((c) => c.id === 'comida')!;
    expect(oculta.activa).toBe(false);
    // Un gasto con esa categoría la sigue viendo (nombre y emoji) en Historial.
    expect(r.categorias.some((c) => c.id === 'comida')).toBe(true);
    expect(marcaOculta(oculta, r.categorias, null)).toBe(' (oculta)');
  });

  it('no se puede ocultar ni borrar si alguna cuenta se quedaría sin categorías', () => {
    const e = estado([cuenta('personal', 0, ['comida', 'salud']), cuenta('hogar', 1, ['comida'])]);
    expect(error(ocultarDelCatalogo(e, 'comida'))).toMatch(/Hogar.*sin categorías/);
    expect(error(borrarCategoria(e, 'comida', 0))).toMatch(/Hogar.*sin categorías/);
  });

  it('una categoría con gastos no se borra; sin gastos sí, y sale de todas las cuentas', () => {
    expect(error(borrarCategoria(dos(), 'comida', 3))).toMatch(/tiene gastos.*Ocúltala/);
    const r = ok(borrarCategoria(dos(), 'comida', 0));
    expect(r.borradas).toEqual(['comida']);
    expect(r.categorias.some((c) => c.id === 'comida')).toBe(false);
    expect(idsDe(r, 'personal')).toEqual(['salud', 'ocio']);
    expect(idsDe(r, 'hogar')).toEqual(['salud']);
  });

  it('volver a mostrar en el catálogo la deja visible solo en la cuenta elegida, si hay cupo', () => {
    const oculta = ok(ocultarDelCatalogo(dos(), 'comida'));
    const r = ok(mostrarEnCatalogo({ categorias: oculta.categorias, cuentas: oculta.cuentas }, 'comida', 'hogar'));
    expect(r.categorias.find((c) => c.id === 'comida')?.activa).toBe(true);
    expect(idsDe(r, 'hogar')).toEqual(['salud', 'comida']);
    expect(idsDe(r, 'personal')).toEqual(['salud', 'ocio']);
  });

});

describe('marca de categorías ocultas (filtro de Historial y Editar gasto)', () => {
  const cats = catalogo().map((c) => (c.id === 'ocio' ? { ...c, activa: false } : c));
  const hogar = cuenta('hogar', 1, ['comida', 'salud']);
  const por = (id: string) => cats.find((c) => c.id === id)!;

  describe('con "Todas las cuentas"', () => {
    const personal = cuenta('personal', 0, ['comida', 'otros']);
    const negocio = cuenta('negocio', 2, ['comida']);
    const extra = cuenta('extra', 3, ['comida']);

    it('oculta del catálogo o sin ninguna cuenta activa que la muestre → "(oculta)"', () => {
      expect(marcaOculta(por('ocio'), cats, null, [personal, hogar])).toBe(' (oculta)');
      expect(marcaOculta(por('mercado'), cats, null, [personal, hogar])).toBe(' (oculta)');
      expect(marcaOculta(por('otros'), cats, null, [hogar])).toBe(' (oculta)'); // una sola cuenta activa y no la muestra
    });

    it('visible solo en algunas → nombra las cuentas donde no está', () => {
      expect(marcaOculta(por('otros'), cats, null, [personal, hogar])).toBe(' (oculta en Hogar)');
      expect(marcaOculta(por('otros'), cats, null, [personal, hogar, negocio])).toBe(' (oculta en Hogar y Negocio)');
      expect(marcaOculta(por('otros'), cats, null, [personal, hogar, negocio, extra])).toBe(' (oculta en 3 cuentas)');
    });

    it('visible en todas las cuentas activas → sin marca', () => {
      expect(marcaOculta(por('comida'), cats, null, [personal, hogar, negocio, extra])).toBe('');
      expect(marcaOculta(por('comida'), cats, undefined, [personal, hogar])).toBe('');
    });

    it('sin cuentas activas que mirar y activa → sin marca', () => {
      expect(marcaOculta(por('otros'), cats, null)).toBe('');
    });

    it('una categoría oculta con el interruptor de la cuenta se ve igual que una oculta en todas (Compras)', () => {
      const e = estado([cuenta('personal', 0, NOMBRES), cuenta('hogar', 1, NOMBRES)]);
      const solo = ok(ocultarEnCuenta(e, 'hogar', 'compras'));
      expect(marcaOculta(solo.categorias.find((c) => c.id === 'compras')!, solo.categorias, null, solo.cuentas)).toBe(' (oculta en Hogar)');
      const dos = ok(ocultarEnCuenta({ categorias: solo.categorias, cuentas: solo.cuentas }, 'personal', 'compras'));
      expect(marcaOculta(dos.categorias.find((c) => c.id === 'compras')!, dos.categorias, null, dos.cuentas)).toBe(' (oculta)');
    });
  });

  it('con una cuenta específica marca además las que esa cuenta no muestra', () => {
    expect(marcaOculta(por('comida'), cats, hogar)).toBe('');
    expect(marcaOculta(por('otros'), cats, hogar)).toBe(' (oculta en Hogar)');
    expect(marcaOculta(por('ocio'), cats, hogar)).toBe(' (oculta)'); // oculta del catálogo gana
  });

  it('el criterio cambia al cambiar de cuenta', () => {
    const personal = cuenta('personal', 0, ['otros']);
    expect(marcaOculta(por('otros'), cats, personal)).toBe('');
    expect(marcaOculta(por('otros'), cats, hogar)).toBe(' (oculta en Hogar)');
  });

  it('en la edición, la categoría actual fuera de la cuenta sale marcada con el nombre de la cuenta', () => {
    const op = opcionesParaEdicion(hogar, cats, 'otros', 'otros');
    const fuera = op.find((o) => o.categoria.id === 'otros')!;
    expect(marcaOculta(fuera.categoria, cats, hogar).trim()).toBe('(oculta en Hogar)');
    expect(marcaOculta(op[0]!.categoria, cats, hogar)).toBe('');
  });
});

describe('avisos y Deshacer al ocultar', () => {
  const dos = (): EstadoCatalogo =>
    estado([cuenta('personal', 0, ['comida', 'mercado', 'salud', 'ocio']), cuenta('hogar', 1, ['salud', 'mercado', 'comida'])]);

  it('los textos nombran la categoría y la cuenta, o sus gastos', () => {
    expect(textoOcultaEnCuenta('Mercado', 'Hogar')).toBe('Mercado ya no aparece en Hogar');
    expect(textoOcultaEnTodas('Mercado', 12)).toBe('Mercado se ocultó en todas las cuentas. Sus 12 gastos siguen en Historial');
    expect(textoOcultaEnTodas('Mercado', 1)).toBe('Mercado se ocultó en todas las cuentas. Su gasto sigue en Historial');
    expect(textoOcultaEnTodas('Mercado', 0)).toBe('Mercado se ocultó en todas las cuentas.');
  });

  it('ocultar en una cuenta y deshacer devuelve su lista exactamente, sin tocar las demás', () => {
    const e = dos();
    const previa = capturarPrevia(e, 'mercado', 'hogar');
    expect(previa.listas).toEqual([{ cuentaId: 'hogar', ids: ['salud', 'mercado', 'comida'] }]);
    const oculto = ok(ocultarEnCuenta(e, 'hogar', 'mercado'));
    expect(idsDe(oculto, 'hogar')).toEqual(['salud', 'comida']);
    const r = ok(deshacerVisibilidad({ categorias: oculto.categorias, cuentas: oculto.cuentas }, previa));
    expect(idsDe(r, 'hogar')).toEqual(['salud', 'mercado', 'comida']);
    expect(idsDe(r, 'personal')).toEqual(['comida', 'mercado', 'salud', 'ocio']);
    expect(r.categorias).toEqual(e.categorias);
  });

  it('ocultar en todas y deshacer restaura activa, visibilidad y orden en cada cuenta', () => {
    const e = dos();
    const previa = capturarPrevia(e, 'mercado', null);
    const oculto = ok(ocultarDelCatalogo(e, 'mercado'));
    expect(oculto.categorias.find((c) => c.id === 'mercado')?.activa).toBe(false);
    expect(idsDe(oculto, 'personal')).not.toContain('mercado');
    const r = ok(deshacerVisibilidad({ categorias: oculto.categorias, cuentas: oculto.cuentas }, previa));
    expect(r.categorias).toEqual(e.categorias);
    expect(idsDe(r, 'personal')).toEqual(['comida', 'mercado', 'salud', 'ocio']);
    expect(idsDe(r, 'hogar')).toEqual(['salud', 'mercado', 'comida']);
  });

  it('deshacer una sola cuenta conserva los cambios hechos mientras tanto en otra', () => {
    const e = dos();
    const previa = capturarPrevia(e, 'mercado', 'hogar');
    const oculto = ok(ocultarEnCuenta(e, 'hogar', 'mercado'));
    const movido = ok(moverEnCuenta({ categorias: oculto.categorias, cuentas: oculto.cuentas }, 'personal', 'ocio', -1));
    const r = ok(deshacerVisibilidad({ categorias: movido.categorias, cuentas: movido.cuentas }, previa));
    expect(idsDe(r, 'hogar')).toEqual(['salud', 'mercado', 'comida']);
    expect(idsDe(r, 'personal')).toEqual(['comida', 'mercado', 'ocio', 'salud']);
  });

  it('si la regla bloquea ocultar no hay nada que deshacer (el error se muestra)', () => {
    const e = estado([cuenta('personal', 0, ['comida'])]);
    expect(error(ocultarEnCuenta(e, 'personal', 'comida'))).toMatch(/al menos 1/);
    expect(error(ocultarDelCatalogo(e, 'comida'))).toMatch(/sin categorías/);
  });

  it('deshacer una categoría que ya no existe da error', () => {
    const e = dos();
    const previa = capturarPrevia(e, 'mercado', null);
    expect(error(deshacerVisibilidad(estado(e.cuentas, e.categorias.filter((c) => c.id !== 'mercado')), previa))).toMatch(/ya no existe/);
  });
});

describe('categoría nueva', () => {
  const dos = (cats: Categoria[] = catalogo()): EstadoCatalogo =>
    estado([cuenta('personal', 0, idsIniciales(cats)), cuenta('hogar', 1, idsIniciales(cats))], cats);

  it('queda visible solo en la cuenta seleccionada (al final) y oculta en las demás', () => {
    const cats = catalogo().slice(0, 5);
    const r = ok(crearCategoria(dos(cats), 'Mascotas', '🐶', 'nueva', 'hogar'));
    expect(idsDe(r, 'hogar')!.at(-1)).toBe('nueva');
    expect(idsDe(r, 'personal')).not.toContain('nueva');
    expect(r.categorias.find((c) => c.id === 'nueva')).toMatchObject({ nombre: 'Mascotas', activa: true, orden: 5 });
    expect(r.aviso).toBeUndefined();
  });

  it('si la cuenta ya tiene 12, se crea oculta y lo avisa', () => {
    const cats = catalogoGrande().slice(0, 12);
    const r = ok(crearCategoria(dos(cats), 'Extra', '', 'nueva', 'hogar'));
    expect(r.categorias).toHaveLength(13);
    expect(idsDe(r, 'hogar')).toHaveLength(MAX_VISIBLES);
    expect(idsDe(r, 'hogar')).not.toContain('nueva');
    expect(r.aviso).toMatch(/12 categorías/);
  });

  it('en una cuenta inexistente falla sin crear nada', () => {
    expect(error(crearCategoria(dos(), 'Mascotas', '', 'nueva', 'fantasma'))).toMatch(/cuenta ya no existe/);
  });
});

describe('Registrar y edición', () => {
  const cats = catalogo();
  const cuentas = [cuenta('personal', 0, ['salud', 'comida', 'otros']), cuenta('hogar', 1, ['hogar', 'servicios'])];

  it('Registrar muestra las visibles de la cuenta actual, en su orden, y cambia al cambiar de cuenta', () => {
    expect(categoriasDeRegistrar(cuentas, 'personal', cats).map((c) => c.id)).toEqual(['salud', 'comida', 'otros']);
    expect(categoriasDeRegistrar(cuentas, 'hogar', cats).map((c) => c.id)).toEqual(['hogar', 'servicios']);
    expect(categoriasDeRegistrar(cuentas, 'personal', cats).map((c) => c.id)).toEqual(['salud', 'comida', 'otros']);
  });

  it('una cuenta desconocida o sin lista cae en las iniciales (nunca queda vacía)', () => {
    expect(categoriasDeRegistrar(cuentas, 'fantasma', cats)).toHaveLength(9);
  });

  it('reordenar en Ajustes se refleja en Registrar', () => {
    const r = ok(moverEnCuenta({ categorias: cats, cuentas }, 'personal', 'otros', -1));
    expect(categoriasDeRegistrar(r.cuentas, 'personal', cats).map((c) => c.id)).toEqual(['salud', 'otros', 'comida']);
  });

  it('la edición incluye la categoría actual del gasto aunque no sea visible (marcada)', () => {
    const op = opcionesParaEdicion(cuentas[1], cats, 'comida', 'comida');
    expect(op.map((o) => [o.categoria.id, o.visible])).toEqual([
      ['hogar', true],
      ['servicios', true],
      ['comida', false],
    ]);
  });

  it('si la categoría actual ya es visible no se duplica ni se marca', () => {
    const op = opcionesParaEdicion(cuentas[0], cats, 'salud', 'salud');
    expect(op).toHaveLength(3);
    expect(op.every((o) => o.visible)).toBe(true);
  });

  it('al cambiar la cuenta del gasto la categoría se conserva, marcada, y la original sigue ofrecida', () => {
    // Gasto de Personal en "salud"; se pasa a Hogar, que no la muestra.
    const op = opcionesParaEdicion(cuentas[1], cats, 'salud', 'salud');
    expect(op.find((o) => o.categoria.id === 'salud')).toMatchObject({ visible: false });
    // Elige otra categoría visible de Hogar: la original sigue ofrecida (marcada) para poder volver.
    const op2 = opcionesParaEdicion(cuentas[1], cats, 'salud', 'servicios');
    expect(op2.map((o) => o.categoria.id)).toEqual(['hogar', 'servicios', 'salud']);
  });

  it('incluye la categoría actual aunque esté oculta del catálogo', () => {
    const ocultas = cats.map((c) => (c.id === 'ocio' ? { ...c, activa: false } : c));
    const op = opcionesParaEdicion(cuentas[0], ocultas, 'ocio', 'ocio');
    expect(op.at(-1)).toMatchObject({ visible: false, categoria: { id: 'ocio' } });
  });
});
