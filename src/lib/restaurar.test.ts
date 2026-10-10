import { describe, expect, it } from 'vitest';
import type { Ajuste, Categoria, Cuenta, Eliminado, Foto, Gasto } from '../types';
import { ErrorRespaldo, FORMATO_RESPALDO, VERSION_ESQUEMA, VERSION_FORMATO, type DatosRespaldo } from './respaldo';
import {
  cargarFotos,
  ejecutarRestauracion,
  esMasReciente,
  planificarFusion,
  planVacio,
  textoResultado,
  textoResumen,
  type EscrituraRestauracion,
  type EstadoLocal,
  type PlanRestauracion,
  type RepoRestauracion,
} from './restaurar';

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-05T10:00:00.000Z';
const T3 = '2026-10-08T10:00:00.000Z';

const gasto = (id: string, extra: Partial<Gasto> = {}): Gasto => ({
  id,
  fecha: '2026-10-01T12:00:00.000Z',
  monto: 10000,
  moneda: 'COP',
  categoriaId: 'comida',
  cuentaId: 'personal',
  nota: '',
  fotoId: null,
  creadoEn: T1,
  editadoEn: T1,
  exportadoEn: null,
  ...extra,
});

const cat = (id: string, orden: number, extra: Partial<Categoria> = {}): Categoria => ({
  id,
  nombre: id[0]!.toUpperCase() + id.slice(1),
  emoji: '🏷️',
  orden,
  activa: true,
  ...extra,
});
const cta = (id: string, orden: number, extra: Partial<Cuenta> = {}): Cuenta => ({
  id,
  nombre: id[0]!.toUpperCase() + id.slice(1),
  emoji: '📒',
  orden,
  archivada: false,
  ...extra,
});

function local(extra: Partial<EstadoLocal> = {}): EstadoLocal {
  return {
    gastos: [],
    categorias: [cat('comida', 0), cat('otros', 1)],
    cuentas: [cta('personal', 0, { categoriaIds: ['comida', 'otros'] })],
    eliminados: [],
    fotosIds: new Set<string>(),
    ajustes: [],
    ...extra,
  };
}

function respaldo(extra: Partial<DatosRespaldo> = {}): DatosRespaldo {
  return {
    formato: FORMATO_RESPALDO,
    versionFormato: VERSION_FORMATO,
    versionEsquema: VERSION_ESQUEMA,
    creadoEn: T3,
    gastos: [],
    categorias: [cat('comida', 0), cat('otros', 1)],
    cuentas: [cta('personal', 0, { categoriaIds: ['comida', 'otros'] })],
    ajustes: {},
    eliminados: [],
    fotos: [],
    ...extra,
  };
}

const fotoMeta = (id: string) => ({ id, archivo: `fotos/${id}.jpg`, miniatura: null, ancho: 10, alto: 10, bytes: 1 });

describe('fusión de gastos por id', () => {
  it('un gasto que no existe aquí se agrega', () => {
    const p = planificarFusion(local(), respaldo({ gastos: [gasto('a')] }));
    expect(p.gastosNuevos.map((g) => g.id)).toEqual(['a']);
    expect(p.gastosActualizados).toEqual([]);
    expect(p.omitidosIguales).toBe(0);
  });

  it('gana el más reciente: el del respaldo actualiza al local más viejo', () => {
    const p = planificarFusion(
      local({ gastos: [gasto('a', { monto: 1, editadoEn: T1 })] }),
      respaldo({ gastos: [gasto('a', { monto: 2, editadoEn: T2 })] }),
    );
    expect(p.gastosActualizados.map((g) => g.monto)).toEqual([2]);
    expect(p.gastosNuevos).toEqual([]);
    expect(p.omitidosIguales).toBe(0);
  });

  it('el del respaldo más antiguo se omite y lo local no se toca', () => {
    const p = planificarFusion(
      local({ gastos: [gasto('a', { monto: 1, editadoEn: T2 })] }),
      respaldo({ gastos: [gasto('a', { monto: 2, editadoEn: T1 })] }),
    );
    expect(p.gastosActualizados).toEqual([]);
    expect(p.gastosNuevos).toEqual([]);
    expect(p.omitidosIguales).toBe(1);
  });

  it('el idéntico (misma versión) se omite', () => {
    const g = gasto('a', { editadoEn: T2 });
    const p = planificarFusion(local({ gastos: [g] }), respaldo({ gastos: [{ ...g }] }));
    expect(p.omitidosIguales).toBe(1);
    expect(planVacio(p)).toBe(true);
  });

  it('sin editadoEn se compara con creadoEn', () => {
    expect(esMasReciente({ creadoEn: T2, editadoEn: '' }, { creadoEn: T1, editadoEn: '' })).toBe(true);
    expect(esMasReciente({ creadoEn: T1, editadoEn: '' }, { creadoEn: T1, editadoEn: T1 })).toBe(false);
    expect(esMasReciente({ creadoEn: T1, editadoEn: T3 }, { creadoEn: T1, editadoEn: T2 })).toBe(true);
  });

  it('compara instantes, no texto (zonas horarias distintas)', () => {
    expect(
      esMasReciente(
        { creadoEn: T1, editadoEn: '2026-10-05T12:00:00.000+02:00' }, // = 10:00 UTC
        { creadoEn: T1, editadoEn: '2026-10-05T09:00:00.000Z' },
      ),
    ).toBe(true);
  });

  it('un gasto del respaldo que aquí se eliminó no se restaura: "omitido (eliminado aquí)"', () => {
    const eliminado: Eliminado = { id: 'a', cuentaId: 'personal', eliminadoEn: T3 };
    const p = planificarFusion(local({ eliminados: [eliminado] }), respaldo({ gastos: [gasto('a'), gasto('b')] }));
    expect(p.gastosNuevos.map((g) => g.id)).toEqual(['b']);
    expect(p.omitidosEliminados).toBe(1);
    expect(p.omitidosIguales).toBe(0);
    expect(textoResumen(p)).toContain('1 (eliminados aquí)');
  });

  it('lo local que no está en el respaldo se queda: nunca se borra nada', () => {
    const p = planificarFusion(local({ gastos: [gasto('solo-local')] }), respaldo({ gastos: [gasto('a')] }));
    // El plan solo agrega/reemplaza; no tiene ninguna operación de borrado.
    expect(Object.keys(p)).not.toContain('borrar');
    expect(p.gastosNuevos.map((g) => g.id)).toEqual(['a']);
  });

  it('un gasto cuya cuenta no existe en ningún lado hace fallar el plan sin cambiar nada', () => {
    expect(() => planificarFusion(local(), respaldo({ gastos: [gasto('a', { cuentaId: 'fantasma' })] }))).toThrow(ErrorRespaldo);
  });
});

describe('categorías y cuentas', () => {
  it('las categorías y cuentas nuevas se agregan, al final del orden local', () => {
    const p = planificarFusion(
      local(),
      respaldo({
        categorias: [cat('comida', 0), cat('mascotas', 0, { emoji: '🐶' })],
        cuentas: [cta('personal', 0), cta('hogar', 1, { categoriaIds: ['mascotas', 'comida'] })],
      }),
    );
    expect(p.categoriasNuevas).toEqual([{ id: 'mascotas', nombre: 'Mascotas', emoji: '🐶', orden: 2, activa: true }]);
    expect(p.cuentasNuevas).toHaveLength(1);
    expect(p.cuentasNuevas[0]).toMatchObject({ id: 'hogar', orden: 1, categoriaIds: ['mascotas', 'comida'] });
  });

  it('una cuenta nueva solo conserva las categorías que existen y están activas', () => {
    const p = planificarFusion(
      local(),
      respaldo({
        categorias: [cat('comida', 0), cat('vieja', 1, { activa: false })],
        cuentas: [cta('personal', 0), cta('hogar', 1, { categoriaIds: ['vieja', 'no-existe', 'comida'] })],
      }),
    );
    expect(p.cuentasNuevas[0]!.categoriaIds).toEqual(['comida']);
  });

  it('las cuentas que ya existen conservan su configuración local de categorías', () => {
    const p = planificarFusion(
      local({ cuentas: [cta('personal', 0, { nombre: 'Mi cuenta', categoriaIds: ['otros'] })] }),
      respaldo({ cuentas: [cta('personal', 0, { nombre: 'Distinto', categoriaIds: ['comida', 'otros'] })] }),
    );
    expect(p.cuentasNuevas).toEqual([]); // no hay nada que escribir: lo local queda como está
  });

  it('las categorías que ya existen no se modifican (nombre, emoji, orden, activa)', () => {
    const p = planificarFusion(
      local({ categorias: [cat('comida', 5, { emoji: '🥘', activa: false })] }),
      respaldo({ categorias: [cat('comida', 0)], cuentas: [cta('personal', 0)] }),
    );
    expect(p.categoriasNuevas).toEqual([]);
  });

  it('una categoría con el mismo nombre pero otro id se toma como la misma y los gastos la siguen', () => {
    const p = planificarFusion(
      local({ categorias: [cat('comida', 0), cat('mascotas', 1)] }),
      respaldo({
        categorias: [cat('comida', 0), cat('uuid-9', 1, { nombre: 'mascotas' })],
        gastos: [gasto('a', { categoriaId: 'uuid-9' })],
      }),
    );
    expect(p.categoriasNuevas).toEqual([]);
    expect(p.gastosNuevos[0]!.categoriaId).toBe('mascotas');
  });

  it('una cuenta con el mismo nombre pero otro id se toma como la misma', () => {
    const p = planificarFusion(
      local(),
      respaldo({
        cuentas: [cta('uuid-7', 0, { nombre: 'personal' })],
        gastos: [gasto('a', { cuentaId: 'uuid-7' })],
      }),
    );
    expect(p.cuentasNuevas).toEqual([]);
    expect(p.gastosNuevos[0]!.cuentaId).toBe('personal');
  });
});

describe('conservación de exportadoEn', () => {
  it('un gasto nuevo conserva el exportadoEn del respaldo ("Solo nuevos" sigue funcionando en un celular nuevo)', () => {
    const p = planificarFusion(local(), respaldo({ gastos: [gasto('a', { exportadoEn: T3 })] }));
    expect(p.gastosNuevos[0]!.exportadoEn).toBe(T3);
  });

  it('al actualizar no se retrocede un exportadoEn local más reciente', () => {
    const p = planificarFusion(
      local({ gastos: [gasto('a', { editadoEn: T1, exportadoEn: T3 })] }),
      respaldo({ gastos: [gasto('a', { editadoEn: T2, exportadoEn: T2 })] }),
    );
    expect(p.gastosActualizados[0]!.exportadoEn).toBe(T3);
  });

  it('un gasto sin exportar sigue sin exportar', () => {
    const p = planificarFusion(local(), respaldo({ gastos: [gasto('a')] }));
    expect(p.gastosNuevos[0]!.exportadoEn).toBeNull();
  });

  it('ultimaExportacion: se toma la del respaldo si es más reciente o aquí no hay', () => {
    const r = respaldo({ ajustes: { ultimaExportacion: T3, monedaPredeterminada: 'USD' } });
    expect(planificarFusion(local({ ajustes: [{ clave: 'ultimaExportacion', valor: null }] }), r).ajustes).toEqual([
      { clave: 'ultimaExportacion', valor: T3 },
      { clave: 'monedaPredeterminada', valor: 'USD' },
    ]);
    const mia: Ajuste[] = [
      { clave: 'ultimaExportacion', valor: '2026-10-09T10:00:00.000Z' },
      { clave: 'monedaPredeterminada', valor: 'COP' },
    ];
    expect(planificarFusion(local({ gastos: [gasto('x')], ajustes: mia }), r).ajustes).toEqual([]); // lo local manda
  });
});

describe('ajustes al restaurar según si la base local tiene gastos', () => {
  const prefs = {
    monedaPredeterminada: 'USD',
    monedasVisibles: ['USD', 'EUR'],
    decimalCsv: 'punto',
    modoRecibo: false,
    ultimaCuenta: 'hogar',
    cuentaPredeterminada: 'hogar',
  };
  const propios: Ajuste[] = [
    { clave: 'monedaPredeterminada', valor: 'COP' },
    { clave: 'monedasVisibles', valor: ['COP', 'USD', 'EUR'] },
    { clave: 'decimalCsv', valor: 'coma' },
    { clave: 'modoRecibo', valor: true },
    { clave: 'ultimaCuenta', valor: 'personal' },
    { clave: 'cuentaPredeterminada', valor: 'personal' },
  ];
  const r = (): DatosRespaldo =>
    respaldo({ ajustes: prefs, cuentas: [cta('personal', 0), cta('hogar', 1)] });

  it('sin gastos locales (teléfono nuevo) mandan los ajustes del respaldo', () => {
    const p = planificarFusion(local({ ajustes: propios }), r());
    const aplicados = Object.fromEntries(p.ajustes.map((a) => [a.clave, a.valor]));
    expect(aplicados).toEqual({
      monedaPredeterminada: 'USD',
      monedasVisibles: ['USD', 'EUR'],
      decimalCsv: 'punto',
      modoRecibo: false,
      ultimaCuenta: 'hogar',
      cuentaPredeterminada: 'hogar',
    });
  });

  it('con gastos locales mandan los ajustes locales', () => {
    const p = planificarFusion(local({ gastos: [gasto('x')], ajustes: propios }), r());
    expect(p.ajustes).toEqual([]);
  });

  it('sin gastos, la cuenta predeterminada se traduce si la cuenta se fusionó con otra del mismo nombre', () => {
    const p = planificarFusion(
      local({ ajustes: propios }),
      respaldo({ ajustes: { cuentaPredeterminada: 'uuid-7' }, cuentas: [cta('uuid-7', 0, { nombre: 'personal' })] }),
    );
    expect(p.ajustes).toEqual([{ clave: 'cuentaPredeterminada', valor: 'personal' }]);
  });

  it('sin gastos, una última cuenta que no existe se ignora', () => {
    const p = planificarFusion(
      local({ ajustes: propios }),
      respaldo({ ajustes: { ultimaCuenta: 'fantasma', cuentaPredeterminada: 'fantasma' }, cuentas: [cta('personal', 0)] }),
    );
    expect(p.ajustes).toEqual([]);
  });
});

describe('eliminados', () => {
  it('se agregan los registros de eliminados que aquí faltan, salvo si el gasto existe aquí', () => {
    const e = (id: string): Eliminado => ({ id, cuentaId: 'personal', eliminadoEn: T3 });
    const p = planificarFusion(
      local({ gastos: [gasto('vivo-aqui')], eliminados: [e('ya-lo-tengo')] }),
      respaldo({ eliminados: [e('ya-lo-tengo'), e('vivo-aqui'), e('nuevo')] }),
    );
    expect(p.eliminadosNuevos.map((x) => x.id)).toEqual(['nuevo']);
  });
});

describe('fotos', () => {
  it('se restauran las que faltan aquí y están en el respaldo', () => {
    const p = planificarFusion(
      local({ fotosIds: new Set(['f-local']) }),
      respaldo({
        gastos: [gasto('a', { fotoId: 'f1' }), gasto('b', { fotoId: 'f-local' })],
        fotos: [fotoMeta('f1'), fotoMeta('f-local')],
      }),
    );
    expect(p.fotosAgregar).toEqual(['f1']);
  });

  it('un gasto omitido cuya foto local falta también la recupera del respaldo', () => {
    const g = gasto('a', { fotoId: 'f1' });
    const p = planificarFusion(local({ gastos: [g] }), respaldo({ gastos: [{ ...g }], fotos: [fotoMeta('f1')] }));
    expect(p.omitidosIguales).toBe(1);
    expect(p.fotosAgregar).toEqual(['f1']);
  });

  it('si la foto no está ni en el respaldo ni aquí, el gasto se restaura sin foto y se cuenta', () => {
    const p = planificarFusion(local(), respaldo({ gastos: [gasto('a', { fotoId: 'perdida' })] }));
    expect(p.gastosNuevos[0]!.fotoId).toBeNull();
    expect(p.fotosFaltantes).toBe(1);
    expect(textoResumen(p)).toContain('sin foto');
  });

  it('no restaura fotos de gastos eliminados aquí', () => {
    const p = planificarFusion(
      local({ eliminados: [{ id: 'a', cuentaId: 'personal', eliminadoEn: T3 }] }),
      respaldo({ gastos: [gasto('a', { fotoId: 'f1' })], fotos: [fotoMeta('f1')] }),
    );
    expect(p.fotosAgregar).toEqual([]);
  });
});

describe('resumen para el usuario', () => {
  it('dice cuántos gastos, fotos, categorías y cuentas', () => {
    const p = planificarFusion(
      local({ gastos: [gasto('viejo', { editadoEn: T1 }), gasto('igual', { editadoEn: T2 })] }),
      respaldo({
        gastos: [
          gasto('n1', { fotoId: 'f1' }),
          gasto('n2'),
          gasto('viejo', { editadoEn: T3 }),
          gasto('igual', { editadoEn: T2 }),
        ],
        categorias: [cat('comida', 0), cat('mascotas', 1)],
        cuentas: [cta('personal', 0), cta('hogar', 1)],
        fotos: [fotoMeta('f1')],
      }),
    );
    expect(textoResumen(p)).toBe(
      'Se agregarán 2 gastos, se actualizará 1, se omitirá 1 (iguales o más antiguos); se agregará 1 foto, 1 categoría y 1 cuenta.',
    );
  });

  it('el aviso final cuenta lo aplicado', () => {
    const p = planificarFusion(local(), respaldo({ gastos: [gasto('a'), gasto('b')] }));
    expect(textoResultado(p)).toBe(
      'Restauración lista: 2 gastos agregados, 0 actualizados, 0 omitidos; 0 fotos, 0 categorías y 0 cuentas agregadas.',
    );
  });
});

// ---------- Transacción: todo o nada ----------

/** Base en memoria con una "transacción" que revierte todo si el cuerpo lanza (como IndexedDB). */
class RepoMemoria implements RepoRestauracion {
  gastos = new Map<string, Gasto>();
  fotos = new Map<string, Foto>();
  categorias = new Map<string, Categoria>();
  cuentas = new Map<string, Cuenta>();
  eliminados = new Map<string, Eliminado>();
  ajustes = new Map<string, unknown>();
  transacciones = 0;
  /** Falla al escribir el lote de gastos número N (para probar el fallo a mitad). */
  fallarEnLoteDeGastos: number | null = null;
  private lotesDeGastos = 0;

  private copia() {
    return {
      gastos: new Map(this.gastos),
      fotos: new Map(this.fotos),
      categorias: new Map(this.categorias),
      cuentas: new Map(this.cuentas),
      eliminados: new Map(this.eliminados),
      ajustes: new Map(this.ajustes),
    };
  }

  async transaccion<T>(operar: (e: EscrituraRestauracion) => Promise<T>): Promise<T> {
    this.transacciones++;
    const antes = this.copia();
    const escribir = <V extends { id: string }>(m: Map<string, V>) => async (filas: V[]): Promise<void> => {
      await Promise.resolve();
      for (const f of filas) m.set(f.id, f);
    };
    try {
      return await operar({
        gastos: async (f) => {
          if (this.fallarEnLoteDeGastos !== null && ++this.lotesDeGastos === this.fallarEnLoteDeGastos) {
            throw new Error('disco lleno');
          }
          await escribir(this.gastos)(f);
        },
        fotos: escribir(this.fotos),
        categorias: escribir(this.categorias),
        cuentas: escribir(this.cuentas),
        eliminados: escribir(this.eliminados),
        ajustes: async (f) => {
          for (const a of f) this.ajustes.set(a.clave, a.valor);
        },
      });
    } catch (e) {
      Object.assign(this, antes); // se revierte todo
      throw e;
    }
  }
}

const fotoReal = (id: string): Foto => ({ id, blob: new Blob([new Uint8Array(5)]), ancho: 1, alto: 1 });

function planGrande(gastos: number, fotos: number): PlanRestauracion {
  const nuevos = Array.from({ length: gastos }, (_, i) => gasto(`g${i}`, { fotoId: i < fotos ? `f${i}` : null }));
  return planificarFusion(
    local(),
    respaldo({
      gastos: nuevos,
      fotos: Array.from({ length: fotos }, (_, i) => fotoMeta(`f${i}`)),
      categorias: [cat('comida', 0), cat('mascotas', 1)],
      cuentas: [cta('personal', 0), cta('hogar', 1)],
      eliminados: [{ id: 'borrado', cuentaId: 'personal', eliminadoEn: T3 }],
      ajustes: { decimalCsv: 'punto' },
    }),
  );
}

describe('transacción completa o nada', () => {
  it('escribe todo en UNA sola transacción', async () => {
    const plan = planGrande(10, 3);
    const repo = new RepoMemoria();
    const fotos = new Map(plan.fotosAgregar.map((id) => [id, fotoReal(id)]));
    await ejecutarRestauracion(plan, fotos, repo);
    expect(repo.transacciones).toBe(1);
    expect(repo.gastos.size).toBe(10);
    expect(repo.fotos.size).toBe(3);
    expect(repo.categorias.has('mascotas')).toBe(true);
    expect(repo.cuentas.has('hogar')).toBe(true);
    expect(repo.eliminados.has('borrado')).toBe(true);
    expect(repo.ajustes.get('decimalCsv')).toBe('punto');
  });

  it('si algo falla a mitad, no queda nada a medias', async () => {
    const plan = planGrande(600, 3); // 3 lotes de gastos de 250
    const repo = new RepoMemoria();
    repo.fallarEnLoteDeGastos = 2;
    const fotos = new Map(plan.fotosAgregar.map((id) => [id, fotoReal(id)]));
    await expect(ejecutarRestauracion(plan, fotos, repo)).rejects.toThrow('disco lleno');
    expect(repo.gastos.size).toBe(0);
    expect(repo.fotos.size).toBe(0);
    expect(repo.categorias.size).toBe(0);
    expect(repo.cuentas.size).toBe(0);
    expect(repo.eliminados.size).toBe(0);
    expect(repo.ajustes.size).toBe(0);
  });

  it('si falta una foto por restaurar, ni siquiera abre la transacción', async () => {
    const plan = planGrande(5, 2);
    const repo = new RepoMemoria();
    await expect(ejecutarRestauracion(plan, new Map(), repo)).rejects.toThrow(/No se pudo leer la foto/);
    expect(repo.transacciones).toBe(0);
    expect(repo.gastos.size).toBe(0);
  });

  it('escribe las fotos antes que los gastos que las usan', async () => {
    const plan = planGrande(3, 3);
    const orden: string[] = [];
    const repo: RepoRestauracion = {
      transaccion: (operar) =>
        operar({
          gastos: async () => void orden.push('gastos'),
          fotos: async () => void orden.push('fotos'),
          categorias: async () => undefined,
          cuentas: async () => undefined,
          eliminados: async () => undefined,
          ajustes: async () => undefined,
        }),
    };
    await ejecutarRestauracion(plan, new Map(plan.fotosAgregar.map((id) => [id, fotoReal(id)])), repo);
    expect(orden.indexOf('fotos')).toBeLessThan(orden.indexOf('gastos'));
  });
});

describe('volumen: 2.000 gastos y 300 fotos', () => {
  it('planifica y aplica por lotes con progreso, sin una sola escritura gigante', async () => {
    const plan = planGrande(2000, 300);
    expect(plan.gastosNuevos).toHaveLength(2000);
    expect(plan.fotosAgregar).toHaveLength(300);
    const repo = new RepoMemoria();
    const avances: number[] = [];
    const tamanos: number[] = [];
    const base = repo.transaccion.bind(repo);
    repo.transaccion = (operar) => base((e) => operar({ ...e, gastos: (f) => (tamanos.push(f.length), e.gastos(f)) }));
    await ejecutarRestauracion(plan, new Map(plan.fotosAgregar.map((id) => [id, fotoReal(id)])), repo, (_t, f) => avances.push(f));
    expect(repo.gastos.size).toBe(2000);
    expect(repo.fotos.size).toBe(300);
    expect(Math.max(...tamanos)).toBeLessThanOrEqual(250);
    expect(avances.length).toBeGreaterThan(8);
    expect(avances[avances.length - 1]).toBe(1);
    expect([...avances].sort((a, b) => a - b)).toEqual(avances); // el progreso nunca retrocede
  });

  it('cargarFotos reporta el avance y cede la pantalla', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `f${i}`);
    const avances: string[] = [];
    const fotos = await cargarFotos(ids, { fotos: ids.map(fotoMeta) }, async () => ({ blob: new Blob([new Uint8Array(3)]) }), (t) => avances.push(t));
    expect(fotos.size).toBe(300);
    expect(avances).toHaveLength(30);
    expect(avances[29]).toBe('Leyendo fotos del respaldo: 300 de 300');
  });
});
