export interface Bitacora {
  /** Anota un paso (también va a la consola, para verlo con chrome://inspect). */
  anotar(paso: string, detalle?: unknown): void;
  /** Todas las líneas, una por paso, con la hora. */
  texto(): string;
  limpiar(): void;
}

const dos = (n: number, largo = 2): string => String(n).padStart(largo, '0');

function resumir(detalle: unknown): string {
  if (detalle === undefined) return '';
  let t: string;
  try {
    t = typeof detalle === 'string' ? detalle : JSON.stringify(detalle);
  } catch {
    t = String(detalle);
  }
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}

/** Registro en memoria de los pasos de una exportación (armado, canShare, share, descarga). */
export function crearBitacora(
  maxLineas = 200,
  ahora: () => Date = () => new Date(),
  consola: Pick<Console, 'info'> = console,
): Bitacora {
  let lineas: string[] = [];
  return {
    anotar(paso, detalle) {
      const d = ahora();
      const hora = `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}.${dos(d.getMilliseconds(), 3)}`;
      const extra = resumir(detalle);
      lineas.push(extra ? `${hora} ${paso} ${extra}` : `${hora} ${paso}`);
      if (lineas.length > maxLineas) lineas = lineas.slice(-maxLineas);
      consola.info('[exportar]', paso, detalle ?? '');
    },
    texto: () => lineas.join('\n'),
    limpiar() {
      lineas = [];
    },
  };
}
