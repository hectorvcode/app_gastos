import { describe, expect, it, vi } from 'vitest';
import { MENSAJE_DESCARTAR, PilaNavegacion, pasosParaLimpiar, type Historia } from './navegacion';

/** Historial de simulacro: `indice` es la posición actual; go() entrega su popstate después, como el navegador. */
function crear(respuesta: boolean | Promise<boolean> = true) {
  let ahora = 0;
  const h = { indice: 0, pendientes: [] as (() => Promise<void>)[] };
  const confirmar = vi.fn(async (_m: string, _e?: unknown) => respuesta);
  let pila!: PilaNavegacion;
  const historia: Historia = {
    empujar: () => void h.indice++,
    retroceder: (n) => {
      h.indice -= n;
      h.pendientes.push(() => pila.alRetroceder());
    },
  };
  pila = new PilaNavegacion(historia, confirmar, () => ahora);

  /** Entrega los popstate que dejaron history.go()/back() programáticos. */
  const soltar = async (): Promise<void> => {
    while (h.pendientes.length > 0) await h.pendientes.shift()!();
  };
  /** El gesto o botón Atrás de Android: si no hay entradas a las que volver, la app se cierra. */
  const androidAtras = async (): Promise<'sale' | 'vuelve'> => {
    if (h.indice === 0) return 'sale';
    h.indice--;
    await pila.alRetroceder();
    return 'vuelve';
  };
  const hoja = (nombre: string, registro: string[], hayCambios?: () => boolean) => ({
    cerrar: () => void registro.push(`cierra ${nombre}`),
    ...(hayCambios ? { hayCambios } : {}),
  });
  return { pila, h, confirmar, soltar, androidAtras, hoja, avanzar: (ms: number) => (ahora += ms) };
}

describe('pila de navegación', () => {
  it('abrir una hoja agrega una entrada al historial y sube la profundidad', () => {
    const { pila, h, hoja } = crear();
    expect(pila.profundidad).toBe(0);
    pila.abrir(hoja('editar', []));
    expect(pila.profundidad).toBe(1);
    expect(h.indice).toBe(1);
  });

  it('el Atrás de Android cierra la hoja abierta en lugar de salir de la app', async () => {
    const { pila, h, hoja, androidAtras } = crear();
    const registro: string[] = [];
    pila.abrir(hoja('nota', registro));
    expect(await androidAtras()).toBe('vuelve');
    expect(registro).toEqual(['cierra nota']);
    expect(pila.profundidad).toBe(0);
    expect(h.indice).toBe(0);
  });

  it('en una pantalla principal sin hojas, Atrás se comporta como siempre (sale)', async () => {
    const { pila, androidAtras } = crear();
    expect(await androidAtras()).toBe('sale');
    expect(pila.profundidad).toBe(0);
  });

  it('con hojas anidadas cierra solo la de arriba', async () => {
    const { pila, h, hoja, androidAtras } = crear();
    const registro: string[] = [];
    pila.abrir(hoja('editar', registro));
    pila.abrir(hoja('moneda', registro));
    expect(h.indice).toBe(2);

    await androidAtras();
    expect(registro).toEqual(['cierra moneda']);
    expect(pila.profundidad).toBe(1);

    await androidAtras();
    expect(registro).toEqual(['cierra moneda', 'cierra editar']);
    expect(pila.profundidad).toBe(0);
    expect(h.indice).toBe(0);
  });

  it('el botón "← Atrás" de la hoja hace lo mismo que el de Android', async () => {
    const { pila, h, hoja, soltar } = crear();
    const registro: string[] = [];
    pila.abrir(hoja('visor', registro));
    pila.atras(); // history.back()
    expect(registro).toEqual([]); // el cierre llega con el popstate
    await soltar();
    expect(registro).toEqual(['cierra visor']);
    expect(pila.profundidad).toBe(0);
    expect(h.indice).toBe(0);
  });

  it('el botón Atrás sin hojas abiertas no hace nada', async () => {
    const { pila, h, soltar } = crear();
    pila.atras();
    await soltar();
    expect(h.indice).toBe(0);
  });

  it('cerrar por código (tras guardar) no pregunta, no deja entradas sueltas y no cierra la hoja de abajo', async () => {
    const { pila, h, confirmar, hoja, soltar } = crear();
    const registro: string[] = [];
    pila.abrir(hoja('editar', registro, () => true));
    const lista = pila.abrir(hoja('cuenta', registro, () => true));
    lista.cerrar();
    await soltar(); // el popstate de nuestro propio go(-1) se descarta
    expect(registro).toEqual(['cierra cuenta']);
    expect(pila.profundidad).toBe(1);
    expect(h.indice).toBe(1);
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('cerrar la de abajo cierra también las que tiene encima, con un solo retroceso', async () => {
    const { pila, h, hoja, soltar } = crear();
    const registro: string[] = [];
    const base = pila.abrir(hoja('editar', registro));
    pila.abrir(hoja('moneda', registro));
    base.cerrar();
    await soltar();
    expect(registro).toEqual(['cierra moneda', 'cierra editar']);
    expect(pila.profundidad).toBe(0);
    expect(h.indice).toBe(0);
  });

  it('cerrar dos veces es inofensivo', async () => {
    const { pila, h, hoja, soltar } = crear();
    const registro: string[] = [];
    const capa = pila.abrir(hoja('nota', registro));
    capa.cerrar();
    capa.cerrar();
    await soltar();
    expect(registro).toEqual(['cierra nota']);
    expect(h.indice).toBe(0);
  });

  describe('cambios sin guardar', () => {
    it('pregunta "¿Descartar cambios?" y, si se descarta, cierra', async () => {
      const { pila, h, confirmar, hoja, soltar, androidAtras } = crear(true);
      const registro: string[] = [];
      pila.abrir(hoja('editar', registro, () => true));
      await androidAtras();
      await soltar();
      expect(confirmar).toHaveBeenCalledWith(MENSAJE_DESCARTAR);
      expect(MENSAJE_DESCARTAR).toBe('¿Descartar cambios?');
      expect(registro).toEqual(['cierra editar']);
      expect(pila.profundidad).toBe(0);
      expect(h.indice).toBe(0);
    });

    it('si se decide seguir editando, la hoja sigue abierta y el historial queda como estaba', async () => {
      const { pila, h, confirmar, hoja, soltar, androidAtras } = crear(false);
      const registro: string[] = [];
      pila.abrir(hoja('editar', registro, () => true));
      await androidAtras();
      await soltar();
      expect(confirmar).toHaveBeenCalledTimes(1);
      expect(registro).toEqual([]);
      expect(pila.profundidad).toBe(1);
      expect(h.indice).toBe(1); // otro Atrás volverá a funcionar
      // ...y un Atrás posterior, ya sin cambios, sí cierra.
      let cambios = true;
      pila.abrir({ cerrar: () => registro.push('cierra otra'), hayCambios: () => cambios });
      cambios = false;
      await androidAtras();
      expect(registro).toEqual(['cierra otra']);
    });

    it('con el botón "← Atrás" también pregunta', async () => {
      const { pila, h, confirmar, hoja, soltar } = crear(true);
      const registro: string[] = [];
      pila.abrir(hoja('editar', registro, () => true));
      pila.atras();
      await soltar();
      expect(confirmar).toHaveBeenCalledTimes(1);
      expect(registro).toEqual(['cierra editar']);
      expect(h.indice).toBe(0);
    });

    it('sin cambios no pregunta', async () => {
      const { pila, confirmar, hoja, androidAtras } = crear();
      const registro: string[] = [];
      pila.abrir(hoja('editar', registro, () => false));
      await androidAtras();
      expect(confirmar).not.toHaveBeenCalled();
      expect(registro).toEqual(['cierra editar']);
    });

    it('con hojas anidadas, la pregunta es de la de arriba; la de abajo con cambios no se toca', async () => {
      const { pila, confirmar, hoja, androidAtras } = crear();
      const registro: string[] = [];
      pila.abrir(hoja('editar', registro, () => true));
      pila.abrir(hoja('moneda', registro)); // la lista no tiene cambios propios
      await androidAtras();
      expect(confirmar).not.toHaveBeenCalled();
      expect(registro).toEqual(['cierra moneda']);
      expect(pila.profundidad).toBe(1);
    });

    it('otro Atrás mientras se pregunta no cierra nada ni rompe el historial', async () => {
      let responder!: (v: boolean) => void;
      const espera = new Promise<boolean>((r) => (responder = r));
      const { pila, h, confirmar, hoja, androidAtras } = crear(espera);
      const registro: string[] = [];
      pila.abrir(hoja('editar', registro, () => true));
      const primero = androidAtras(); // abre la pregunta
      await Promise.resolve();
      await androidAtras(); // segundo Atrás con el cuadro abierto
      expect(h.indice).toBe(1);
      expect(registro).toEqual([]);
      responder(false);
      await primero;
      expect(confirmar).toHaveBeenCalledTimes(1);
      expect(pila.profundidad).toBe(1);
      expect(h.indice).toBe(1);
    });
  });

  it('una hoja puede traer su propia pregunta (Archivo listo) y sus etiquetas', async () => {
    const { pila, h, confirmar, soltar } = crear(true);
    const registro: string[] = [];
    pila.abrir({
      cerrar: () => void registro.push('cierra listo'),
      hayCambios: () => true,
      confirmacion: { mensaje: '¿Descartar el archivo preparado?', descartar: 'Descartar archivo', seguir: 'Conservarlo' },
    });
    pila.atras();
    await soltar();
    expect(confirmar).toHaveBeenCalledWith('¿Descartar el archivo preparado?', { descartar: 'Descartar archivo', seguir: 'Conservarlo' });
    expect(registro).toEqual(['cierra listo']);
    expect(h.indice).toBe(0);
  });

  it('cerrar "Archivo listo" por código (al terminar de compartir) no pregunta', async () => {
    const { pila, confirmar, soltar } = crear();
    const capa = pila.abrir({ cerrar: () => {}, hayCambios: () => true, confirmacion: { mensaje: '¿Descartar el archivo preparado?' } });
    capa.cerrar();
    await soltar();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('si un retroceso programático nunca produce su popstate, el descarte caduca y el siguiente Atrás cuenta', async () => {
    const { pila, h, hoja, avanzar, androidAtras } = crear();
    const registro: string[] = [];
    pila.abrir(hoja('nota', registro)).cerrar(); // go(-1) sin entregar su popstate
    h.pendientes.length = 0;
    avanzar(5000);
    pila.abrir(hoja('foto', registro));
    await androidAtras();
    expect(registro).toEqual(['cierra nota', 'cierra foto']);
  });
});

describe('limpieza del historial al recargar con una hoja abierta', () => {
  it('devuelve cuántas entradas hay sobre la base', () => {
    expect(pasosParaLimpiar({ hoja: true, n: 1 })).toBe(1);
    expect(pasosParaLimpiar({ hoja: true, n: 3 })).toBe(3);
  });

  it('sin estado de hoja no hace nada', () => {
    const basura = [null, undefined, {}, 'x', 4, { hoja: false, n: 2 }, { hoja: true }, { hoja: true, n: 0 }, { hoja: true, n: -1 }, { hoja: true, n: 1.5 }, { hoja: true, n: '2' }];
    for (const x of basura) expect(pasosParaLimpiar(x)).toBe(0);
  });

  it('acota un valor desmesurado para no salir de la app', () => {
    expect(pasosParaLimpiar({ hoja: true, n: 500 })).toBe(20);
  });
});
