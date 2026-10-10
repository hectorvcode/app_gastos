import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { Categoria, Cuenta, Gasto } from '../types';
import {
  armarRespaldo,
  crearDatosRespaldo,
  ErrorRespaldo,
  FORMATO_RESPALDO,
  leerRespaldoZip,
  nombreRespaldo,
  validarDatos,
  VERSION_ESQUEMA,
  VERSION_FORMATO,
  type DatosRespaldo,
  type EntradaRespaldo,
} from './respaldo';

const gasto = (id: string, extra: Partial<Gasto> = {}): Gasto => ({
  id,
  fecha: '2026-10-07T18:42:00.000Z',
  monto: 45000,
  moneda: 'COP',
  categoriaId: 'comida',
  cuentaId: 'personal',
  nota: '',
  fotoId: null,
  creadoEn: '2026-10-07T18:42:00.000Z',
  editadoEn: '2026-10-07T18:42:00.000Z',
  exportadoEn: null,
  ...extra,
});

const categorias: Categoria[] = [
  { id: 'comida', nombre: 'Comida', emoji: '🍽️', orden: 0, activa: true },
  { id: 'otros', nombre: 'Otros', emoji: '📦', orden: 1, activa: true },
];
const cuentas: Cuenta[] = [
  { id: 'personal', nombre: 'Personal', emoji: '👤', orden: 0, archivada: false, categoriaIds: ['otros', 'comida'] },
];

const jpeg = (n: number, tipo = 'image/jpeg'): Blob => new Blob([new Uint8Array(n).fill(7)], { type: tipo });

function entrada(extra: Partial<EntradaRespaldo> = {}): EntradaRespaldo {
  return {
    gastos: [gasto('g1', { fotoId: 'f1', exportadoEn: '2026-10-08T00:00:00.000Z' }), gasto('g2')],
    categorias,
    cuentas,
    eliminados: [{ id: 'g0', cuentaId: 'personal', eliminadoEn: '2026-10-09T10:00:00.000Z' }],
    ajustes: [
      { clave: 'monedaPredeterminada', valor: 'COP' },
      { clave: 'ultimaExportacion', valor: '2026-10-08T00:00:00.000Z' },
      { clave: 'versionEsquema', valor: 4 },
      { clave: 'borrador', valor: { monto: '1' } },
      { clave: 'fotoPendiente', valor: 'x' },
      { clave: 'ultimoRespaldo', valor: { fecha: 'x' } },
    ],
    fotos: [{ id: 'f1', blob: jpeg(300), miniatura: jpeg(40), ancho: 1080, alto: 2310 }],
    ...extra,
  };
}

const AHORA = new Date(2026, 9, 9, 20, 15, 30);

describe('contenido y versión de datos.json', () => {
  it('lleva formato, versión de formato, versión de esquema y fecha', () => {
    const d = crearDatosRespaldo(entrada(), AHORA);
    expect(d.formato).toBe(FORMATO_RESPALDO);
    expect(d.versionFormato).toBe(VERSION_FORMATO);
    expect(d.versionEsquema).toBe(VERSION_ESQUEMA);
    expect(d.versionEsquema).toBe(4);
    expect(d.creadoEn).toBe(AHORA.toISOString());
  });

  it('incluye gastos, categorías, cuentas con categoriaIds, eliminados y metadatos de fotos', () => {
    const d = crearDatosRespaldo(entrada(), AHORA);
    expect(d.gastos.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(d.gastos[0]!.exportadoEn).toBe('2026-10-08T00:00:00.000Z'); // el respaldo no toca exportadoEn
    expect(d.categorias).toEqual(categorias);
    expect(d.cuentas[0]!.categoriaIds).toEqual(['otros', 'comida']);
    expect(d.eliminados).toHaveLength(1);
    expect(d.fotos).toEqual([
      { id: 'f1', archivo: 'fotos/f1.jpg', miniatura: 'miniaturas/f1.jpg', ancho: 1080, alto: 2310, bytes: 300 },
    ]);
  });

  it('en ajustes deja fuera lo temporal y lo que describe al propio respaldo', () => {
    const d = crearDatosRespaldo(entrada(), AHORA);
    expect(d.ajustes).toEqual({
      monedaPredeterminada: 'COP',
      ultimaExportacion: '2026-10-08T00:00:00.000Z',
    });
  });

  it('el nombre es respaldo_gastos_AAAAMMDD-HHMMSS.zip con la hora local', () => {
    expect(nombreRespaldo(AHORA)).toBe('respaldo_gastos_20261009-201530.zip');
  });

  it('el ZIP trae datos.json y los JPEG sin recomprimir', async () => {
    const e = entrada();
    const zipBlob = await armarRespaldo(crearDatosRespaldo(e, AHORA), e.fotos);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['datos.json', 'fotos/f1.jpg', 'miniaturas/f1.jpg']));
    const datos = JSON.parse(await zip.file('datos.json')!.async('string')) as DatosRespaldo;
    expect(datos.gastos).toHaveLength(2);
    const bytes = await zip.file('fotos/f1.jpg')!.async('uint8array');
    expect(bytes).toEqual(new Uint8Array(300).fill(7)); // idéntica a la original
  });

  it('ida y vuelta: lo que se respalda es lo que se lee', async () => {
    const e = entrada();
    const zipBlob = await armarRespaldo(crearDatosRespaldo(e, AHORA), e.fotos);
    const leido = await leerRespaldoZip(await zipBlob.arrayBuffer());
    expect(leido.fotosAusentes).toBe(0);
    expect(leido.datos.gastos).toEqual(e.gastos);
    expect(leido.datos.cuentas).toEqual(cuentas);
    const f = await leido.leerFoto('f1');
    expect(f.blob.size).toBe(300);
    expect(f.miniatura?.size).toBe(40);
  });
});

describe('validación de archivos inválidos', () => {
  const buenos = (): Record<string, unknown> => JSON.parse(JSON.stringify(crearDatosRespaldo(entrada(), AHORA)));
  const falla = (json: unknown, texto: RegExp): void => {
    expect(() => validarDatos(json)).toThrow(ErrorRespaldo);
    expect(() => validarDatos(json)).toThrow(texto);
  };

  it('acepta un respaldo válido', () => {
    expect(validarDatos(buenos()).gastos).toHaveLength(2);
  });

  it('rechaza algo que no es un respaldo de la app', () => {
    falla([], /no es un respaldo/);
    falla({ gastos: [] }, /no es un respaldo/);
    falla({ ...buenos(), formato: 'otra-cosa' }, /no es un respaldo/);
  });

  it('rechaza un formato más nuevo o sin versión', () => {
    falla({ ...buenos(), versionFormato: VERSION_FORMATO + 1 }, /versión más nueva/);
    falla({ ...buenos(), versionFormato: undefined }, /no es compatible/);
    falla({ ...buenos(), versionEsquema: VERSION_ESQUEMA + 1 }, /versión más nueva/);
    falla({ ...buenos(), versionEsquema: 'x' }, /versionEsquema/);
  });

  it('rechaza listas que faltan o gastos dañados, diciendo cuál', () => {
    const sinGastos = buenos();
    delete sinGastos.gastos;
    falla(sinGastos, /lista "gastos"/);
    const d1 = buenos();
    (d1.gastos as Record<string, unknown>[])[1]!.monto = -5;
    falla(d1, /número 2.*\(g2\).*monto/);
    const d2 = buenos();
    (d2.gastos as Record<string, unknown>[])[0]!.fecha = 'ayer';
    falla(d2, /\(g1\).*fecha/);
    const d3 = buenos();
    (d3.gastos as Record<string, unknown>[])[0]!.moneda = 'pesos';
    falla(d3, /moneda/);
    const d4 = buenos();
    (d4.gastos as Record<string, unknown>[])[0]!.cuentaId = '';
    falla(d4, /cuenta/);
  });

  it('rechaza ids repetidos', () => {
    const d = buenos();
    (d.gastos as Record<string, unknown>[])[1]!.id = 'g1';
    falla(d, /gasto repetido \(g1\)/);
  });

  it('rechaza rutas de fotos que se salgan de fotos/', () => {
    const d = buenos();
    (d.fotos as Record<string, unknown>[])[0]!.archivo = '../datos.json';
    falla(d, /foto número 1/);
  });

  it('un archivo que no es ZIP se rechaza con el motivo', async () => {
    const e = leerRespaldoZip(new TextEncoder().encode('esto no es un zip'));
    await expect(e).rejects.toThrow(/no es un ZIP válido/);
  });

  it('un ZIP sin datos.json se rechaza', async () => {
    const z = new JSZip();
    z.file('otra-cosa.txt', 'hola');
    const buf = await z.generateAsync({ type: 'uint8array' });
    await expect(leerRespaldoZip(buf)).rejects.toThrow(/no contiene datos\.json/);
  });

  it('un datos.json que no es JSON se rechaza', async () => {
    const z = new JSZip();
    z.file('datos.json', '{ roto');
    const buf = await z.generateAsync({ type: 'uint8array' });
    await expect(leerRespaldoZip(buf)).rejects.toThrow(/no se pudo leer como JSON/);
  });

  it('cuenta las fotos declaradas que no están en el ZIP', async () => {
    const z = new JSZip();
    z.file('datos.json', JSON.stringify(crearDatosRespaldo(entrada(), AHORA)));
    const buf = await z.generateAsync({ type: 'uint8array' });
    const leido = await leerRespaldoZip(buf);
    expect(leido.fotosAusentes).toBe(1);
    expect(leido.datos.fotos).toEqual([]);
  });
});
