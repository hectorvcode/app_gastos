import { describe, expect, it } from 'vitest';
import {
  avisoRecuperacion,
  BORRADOR_VIGENCIA_MS,
  borrarBorrador,
  guardarBorrador,
  guardarFotoPendiente,
  leerBorrador,
  MSG_FOTO_PERDIDA,
  MSG_RECUPERADO,
  validarBorrador,
  type InstantaneaRegistro,
  type RepoBorrador,
} from './borrador';
import type { FotoProcesada } from './fotos';
import type { Key } from './money';
import { SesionRegistro } from './registro';

function repoEnMemoria() {
  const datos = new Map<string, unknown>();
  const repo: RepoBorrador = {
    get: async (k) => datos.get(k),
    set: async (k, v) => void datos.set(k, v),
    delete: async (k) => void datos.delete(k),
  };
  return { datos, repo };
}

const snap: InstantaneaRegistro = { entry: '45000', moneda: 'COP', fecha: '2026-10-05', cuentaId: 'hogar', nota: 'Almuerzo' };
const T0 = Date.UTC(2026, 9, 8, 15, 0, 0);
const foto = (): FotoProcesada => ({ blob: new Blob([new Uint8Array(50)]), miniatura: new Blob([new Uint8Array(5)]), ancho: 1000, alto: 4000, diag: 'EXIF 6 · app' });

describe('borrador del gasto en curso', () => {
  it('guarda y restaura monto, moneda, fecha, cuenta, nota y la marca de espera', async () => {
    const { repo } = repoEnMemoria();
    await guardarBorrador(repo, snap, true, T0);
    const r = await leerBorrador(repo, T0 + 60_000);
    expect(r?.borrador).toEqual({ ...snap, esperandoFoto: true, guardadoEn: T0 });
    expect(r?.foto).toBeNull();
  });
  it('un borrador de menos de 15 minutos sigue vigente', async () => {
    const { repo } = repoEnMemoria();
    await guardarBorrador(repo, snap, false, T0);
    expect(await leerBorrador(repo, T0 + BORRADOR_VIGENCIA_MS - 1)).not.toBeNull();
  });
  it('a los 15 minutos se descarta sin avisar, junto con su foto', async () => {
    const { repo, datos } = repoEnMemoria();
    await guardarBorrador(repo, snap, false, T0);
    await guardarFotoPendiente(repo, foto());
    expect(await leerBorrador(repo, T0 + BORRADOR_VIGENCIA_MS)).toBeNull();
    expect(datos.size).toBe(0);
  });
  it('se borra tras guardar el gasto (o al descartarlo)', async () => {
    const { repo, datos } = repoEnMemoria();
    await guardarBorrador(repo, snap, false, T0);
    await guardarFotoPendiente(repo, foto());
    await borrarBorrador(repo);
    expect(datos.size).toBe(0);
    expect(await leerBorrador(repo, T0)).toBeNull();
  });
  it('un borrador dañado o con una hora futura se descarta', async () => {
    const { repo, datos } = repoEnMemoria();
    datos.set('borrador', { entry: 'abc', moneda: 'COP' });
    expect(await leerBorrador(repo, T0)).toBeNull();
    await guardarBorrador(repo, snap, false, T0 + 10 * 60_000);
    expect(await leerBorrador(repo, T0)).toBeNull();
    expect(validarBorrador('texto')).toBeNull();
    expect(validarBorrador(null)).toBeNull();
  });
});

describe('foto pendiente persistida', () => {
  it('sobrevive a una recarga: vuelve con sus bytes, medidas y diagnóstico', async () => {
    const { repo } = repoEnMemoria();
    await guardarBorrador(repo, snap, false, T0);
    await guardarFotoPendiente(repo, foto());
    const r = await leerBorrador(repo, T0 + 1000);
    expect(r?.foto).toMatchObject({ ancho: 1000, alto: 4000, diag: 'EXIF 6 · app' });
    expect(r?.foto?.blob.size).toBe(50);
    expect(r?.foto?.miniatura.size).toBe(5);
  });
  it('al quitar la foto pendiente se borra de IndexedDB', async () => {
    const { repo, datos } = repoEnMemoria();
    await guardarFotoPendiente(repo, foto());
    expect(datos.has('fotoPendiente')).toBe(true);
    await guardarFotoPendiente(repo, null);
    expect(datos.has('fotoPendiente')).toBe(false);
  });
  it('una foto dañada se ignora y el borrador se recupera sin ella', async () => {
    const { repo, datos } = repoEnMemoria();
    await guardarBorrador(repo, snap, false, T0);
    datos.set('fotoPendiente', { blob: 'no es un blob' });
    const r = await leerBorrador(repo, T0);
    expect(r?.borrador.entry).toBe('45000');
    expect(r?.foto).toBeNull();
  });
});

describe('avisos al recuperar', () => {
  it('con la foto ya procesada: solo el aviso de recuperación', async () => {
    const { repo } = repoEnMemoria();
    await guardarBorrador(repo, snap, false, T0);
    await guardarFotoPendiente(repo, foto());
    expect(avisoRecuperacion((await leerBorrador(repo, T0))!)).toBe('Recuperamos el gasto que estabas registrando.');
  });
  it('si la foto no llegó, agrega que se perdió y cómo repetirla', async () => {
    const { repo } = repoEnMemoria();
    await guardarBorrador(repo, snap, true, T0);
    const texto = avisoRecuperacion((await leerBorrador(repo, T0))!);
    expect(texto).toBe(`${MSG_RECUPERADO} ${MSG_FOTO_PERDIDA}`);
    expect(texto).toContain('La foto se perdió porque Android cerró la app al abrir la cámara. Tómala de nuevo o elígela de la galería.');
  });
});

describe('SesionRegistro: instantánea y restauración', () => {
  const crear = () =>
    new SesionRegistro('COP', { add: async () => {}, delete: async () => {} }, () => new Date(2026, 9, 8, 10, 0), () => 'id');

  it('restaura monto, moneda, fecha elegida, cuenta y nota', () => {
    const s = crear();
    s.restaurar({ entry: '12.5', moneda: 'USD', fecha: '2026-10-05', cuentaId: 'hogar', nota: 'Taxi' }, ['COP', 'USD'], ['personal', 'hogar']);
    expect(s.instantanea()).toEqual({ entry: '12.5', moneda: 'USD', fecha: '2026-10-05', cuentaId: 'hogar', nota: 'Taxi' });
  });
  it('"Hoy" se guarda como fecha null', () => {
    const s = crear();
    s.pulsar('5' as Key);
    expect(s.instantanea()).toMatchObject({ entry: '5', fecha: null });
  });
  it('ignora una moneda oculta o una cuenta que ya no existe, y no admite fechas futuras', () => {
    const s = crear();
    s.restaurar({ entry: '12.75', moneda: 'EUR', fecha: '2027-01-01', cuentaId: 'borrada', nota: '' }, ['COP', 'USD'], ['personal']);
    expect(s.moneda).toBe('COP');
    expect(s.entry).toBe('12'); // COP no admite decimales
    expect(s.cuentaId).toBe('personal');
    expect(s.instantanea().fecha).toBeNull();
  });
});
