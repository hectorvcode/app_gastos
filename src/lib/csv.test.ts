import { describe, expect, it } from 'vitest';
import {
  BOM,
  COLUMNAS,
  decimalDeAjuste,
  escaparCampo,
  formatearMontoCsv,
  generarCsv,
  separadorDe,
  type FilaCsv,
} from './csv';

function fila(p: Partial<FilaCsv> = {}): FilaCsv {
  return {
    id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
    fecha: '2026-10-07',
    hora: '13:42',
    monto: 45000,
    moneda: 'COP',
    categoria: 'Comida',
    cuenta: 'Personal',
    nota: '',
    foto: '',
    cambio: 'nuevo',
    ...p,
  };
}

describe('formatearMontoCsv', () => {
  it('COP sin decimales y sin separador de miles', () => {
    expect(formatearMontoCsv(45000, 'COP', 'punto')).toBe('45000');
    expect(formatearMontoCsv(1234567, 'COP', 'coma')).toBe('1234567');
  });
  it('USD y EUR: hasta 2 decimales, sin ceros sobrantes', () => {
    expect(formatearMontoCsv(12.5, 'USD', 'punto')).toBe('12.5');
    expect(formatearMontoCsv(12.34, 'EUR', 'punto')).toBe('12.34');
    expect(formatearMontoCsv(12, 'USD', 'punto')).toBe('12');
  });
  it('con coma, el decimal lleva coma', () => {
    expect(formatearMontoCsv(12.5, 'USD', 'coma')).toBe('12,5');
    expect(formatearMontoCsv(0.07, 'EUR', 'coma')).toBe('0,07');
  });
  it('no arrastra ruido de coma flotante', () => {
    expect(formatearMontoCsv(0.1 + 0.2, 'USD', 'punto')).toBe('0.3');
  });
});

describe('escaparCampo', () => {
  it('deja intacto el texto simple', () => {
    expect(escaparCampo('Almuerzo con equipo')).toBe('Almuerzo con equipo');
  });
  it('encierra entre comillas si hay comas, punto y coma, comillas o saltos de línea', () => {
    expect(escaparCampo('pan, leche')).toBe('"pan, leche"');
    expect(escaparCampo('a;b')).toBe('"a;b"');
    expect(escaparCampo('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
    expect(escaparCampo('a\r\nb')).toBe('"a\r\nb"');
  });
  it('duplica las comillas internas', () => {
    expect(escaparCampo('dijo "hola"')).toBe('"dijo ""hola"""');
  });
});

describe('generarCsv', () => {
  it('empieza con BOM y el encabezado con las 10 columnas', () => {
    const csv = generarCsv([], 'punto');
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1)).toBe('id,fecha,hora,monto,moneda,categoria,cuenta,nota,foto,cambio\r\n');
    expect(COLUMNAS).toHaveLength(10);
  });
  it('los bytes empiezan con EF BB BF (UTF-8 con BOM)', async () => {
    const bytes = new Uint8Array(await new Blob([generarCsv([fila()], 'coma')]).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
  it('decimal con punto: columnas separadas por coma', () => {
    const csv = generarCsv([fila({ monto: 12.5, moneda: 'USD', foto: '3f2a9c1e.jpg' })], 'punto');
    expect(csv).toContain(
      '\r\n3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90,2026-10-07,13:42,12.5,USD,Comida,Personal,,3f2a9c1e.jpg,nuevo\r\n',
    );
  });
  it('decimal con coma: columnas separadas por punto y coma y monto con coma', () => {
    const csv = generarCsv([fila({ monto: 12.5, moneda: 'USD' })], 'coma');
    expect(csv.slice(1).split('\r\n')[0]).toBe('id;fecha;hora;monto;moneda;categoria;cuenta;nota;foto;cambio');
    expect(csv).toContain(';2026-10-07;13:42;12,5;USD;Comida;Personal;;;nuevo\r\n');
    expect(separadorDe('coma')).toBe(';');
    expect(separadorDe('punto')).toBe(',');
  });
  it('mezcla monedas con y sin decimales en el mismo archivo', () => {
    const csv = generarCsv([fila({ monto: 45000 }), fila({ monto: 9.99, moneda: 'EUR' })], 'punto');
    const lineas = csv.split('\r\n');
    expect(lineas[1]).toContain(',45000,COP,');
    expect(lineas[2]).toContain(',9.99,EUR,');
  });
  it('la nota con comas, comillas y saltos de línea se conserva entre comillas', () => {
    const csv = generarCsv([fila({ nota: 'pan, "integral"\nsin sal' })], 'punto');
    expect(csv).toContain(',Personal,"pan, ""integral""\nsin sal",,nuevo\r\n');
  });
  it('la fila eliminada deja vacíos monto, moneda, categoría, nota y foto', () => {
    const csv = generarCsv(
      [fila({ monto: null, moneda: '', categoria: '', cambio: 'eliminado', fecha: '2026-10-08', hora: '09:15' })],
      'punto',
    );
    expect(csv).toContain('3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90,2026-10-08,09:15,,,,Personal,,,eliminado\r\n');
  });
});

describe('decimalDeAjuste', () => {
  it('por defecto es coma', () => {
    expect(decimalDeAjuste(undefined)).toBe('coma');
    expect(decimalDeAjuste(null)).toBe('coma');
    expect(decimalDeAjuste('otra cosa')).toBe('coma');
  });
  it('respeta una elección guardada', () => {
    expect(decimalDeAjuste('punto')).toBe('punto');
    expect(decimalDeAjuste('coma')).toBe('coma');
  });
});
