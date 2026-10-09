/**
 * Pila de hojas y pantallas secundarias, ligada a la History API para que el botón o gesto Atrás
 * de Android cierre la de arriba en lugar de salir de la app. No toca el DOM: `Historia` y `Confirmar`
 * se inyectan (en la app son `window.history` y un cuadro propio; en las pruebas, simulacros).
 *
 * Flujo: al abrir una hoja se hace `pushState` y se apila; al volver (popstate) se cierra la de arriba.
 * Los botones "← Atrás" llaman a `atras()`, que hace `history.back()` y deja que `alRetroceder` cierre,
 * así el botón de pantalla y el de Android pasan por el mismo camino (y la misma confirmación).
 * Cerrar por código (p. ej. tras guardar) usa `Capa.cerrar()`, sin preguntar.
 */

export interface Historia {
  /** history.pushState: agrega una entrada. */
  empujar(): void;
  /** history.go(-pasos): vuelve esas entradas; el navegador dispara un solo popstate. */
  retroceder(pasos: number): void;
}

/** Textos de los dos botones del cuadro de confirmación. */
export interface EtiquetasConfirmacion {
  descartar?: string;
  seguir?: string;
}

/** Pregunta sí/no al usuario; true = descartar. */
export type Confirmar = (mensaje: string, etiquetas?: EtiquetasConfirmacion) => Promise<boolean>;

export interface OpcionesCapa {
  /** Oculta la hoja. Debe ser idempotente. */
  cerrar(): void;
  /** Si devuelve true, Atrás pregunta "¿Descartar cambios?" antes de cerrar. */
  hayCambios?(): boolean;
  /** Texto de la pregunta cuando hay algo que perder; por defecto "¿Descartar cambios?". */
  confirmacion?: { mensaje: string } & EtiquetasConfirmacion;
}

export interface Capa {
  /** Cierra esta hoja (y las que estén encima) sin preguntar. No hace nada si ya está cerrada. */
  cerrar(): void;
}

export const MENSAJE_DESCARTAR = '¿Descartar cambios?';

/** Un popstate provocado por nuestro propio retroceder() se descarta; si nunca llega, caduca. */
const CADUCIDAD_IGNORADO_MS = 1500;

export class PilaNavegacion {
  private capas: OpcionesCapa[] = [];
  private ignorados: number[] = [];
  private confirmando = false;

  constructor(
    private readonly historia: Historia,
    private readonly confirmar: Confirmar,
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Hojas abiertas ahora. */
  get profundidad(): number {
    return this.capas.length;
  }

  /** Registra una hoja recién abierta (agrega una entrada al historial). */
  abrir(opciones: OpcionesCapa): Capa {
    this.capas.push(opciones);
    this.historia.empujar();
    return { cerrar: () => this.cerrarDesde(opciones) };
  }

  /** Botón "← Atrás" de una hoja: igual que el Atrás de Android. Sin hojas abiertas no hace nada. */
  atras(): void {
    if (this.capas.length > 0) this.historia.retroceder(1);
  }

  /** Para el evento `popstate`. Con hojas abiertas cierra la de arriba; sin ellas deja que Atrás actúe como siempre. */
  async alRetroceder(): Promise<void> {
    if (this.consumirIgnorado()) return;
    if (this.confirmando) {
      this.historia.empujar(); // otro Atrás mientras se pregunta: se restituye la entrada
      return;
    }
    const tope = this.capas[this.capas.length - 1];
    if (!tope) return;
    if (!tope.hayCambios?.()) {
      this.capas.pop();
      tope.cerrar();
      return;
    }
    // Con cambios sin guardar: se restituye la entrada y se pregunta; la hoja sigue abierta mientras tanto.
    this.confirmando = true;
    this.historia.empujar();
    let descartar = false;
    try {
      const c = tope.confirmacion;
      descartar = c
        ? await this.confirmar(c.mensaje, { ...(c.descartar ? { descartar: c.descartar } : {}), ...(c.seguir ? { seguir: c.seguir } : {}) })
        : await this.confirmar(MENSAJE_DESCARTAR);
    } finally {
      this.confirmando = false;
    }
    if (!descartar || this.capas[this.capas.length - 1] !== tope) return;
    this.capas.pop();
    tope.cerrar();
    this.retrocederSinEvento(1);
  }

  private cerrarDesde(opciones: OpcionesCapa): void {
    const i = this.capas.indexOf(opciones);
    if (i < 0) return;
    const quitadas = this.capas.splice(i);
    for (const q of quitadas.reverse()) q.cerrar();
    this.retrocederSinEvento(quitadas.length);
  }

  private retrocederSinEvento(pasos: number): void {
    this.ignorados.push(this.ahora());
    this.historia.retroceder(pasos);
  }

  private consumirIgnorado(): boolean {
    const limite = this.ahora() - CADUCIDAD_IGNORADO_MS;
    this.ignorados = this.ignorados.filter((t) => t >= limite);
    return this.ignorados.shift() !== undefined;
  }
}

const MAX_LIMPIEZA = 20;

/**
 * Al iniciar: si la página se recargó con hojas abiertas, la entrada actual del historial conserva el estado
 * `{ hoja: true, n }` (n = entradas que hay que volver para llegar a la base). Devuelve cuántas, para que
 * ningún Atrás posterior quede sin efecto visible. 0 si el estado no es de una hoja.
 */
export function pasosParaLimpiar(estado: unknown): number {
  if (typeof estado !== 'object' || estado === null) return 0;
  const { hoja, n } = estado as { hoja?: unknown; n?: unknown };
  if (hoja !== true || typeof n !== 'number' || !Number.isInteger(n) || n < 1) return 0;
  return Math.min(n, MAX_LIMPIEZA);
}
