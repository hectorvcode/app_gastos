import { describe, expect, it } from 'vitest';
import { adaptarEntry, formatEntryPartes, formatMonto, montoParaCampo } from './money';

describe('formato por moneda', () => {
  it('COP sin decimales, USD y EUR con 2', () => {
    expect(formatMonto(45000, 'COP')).toBe('45.000');
    expect(formatMonto(12.5, 'USD')).toBe('12,50');
    expect(formatMonto(1234.5, 'EUR')).toBe('1.234,50');
    expect(formatMonto(7, 'USD')).toBe('7,00');
  });
});

describe('formatEntryPartes', () => {
  it('USD y EUR completan los decimales con relleno', () => {
    expect(formatEntryPartes('', 'USD')).toEqual({ escrito: '0', relleno: ',00' });
    expect(formatEntryPartes('12', 'USD')).toEqual({ escrito: '12', relleno: ',00' });
    expect(formatEntryPartes('12.', 'USD')).toEqual({ escrito: '12,', relleno: '00' });
    expect(formatEntryPartes('12.5', 'EUR')).toEqual({ escrito: '12,5', relleno: '0' });
    expect(formatEntryPartes('12.50', 'EUR')).toEqual({ escrito: '12,50', relleno: '' });
  });
  it('COP nunca lleva relleno', () => {
    expect(formatEntryPartes('45000', 'COP')).toEqual({ escrito: '45.000', relleno: '' });
  });
});

describe('adaptarEntry (cambio de moneda con monto escrito)', () => {
  it('a una moneda sin decimales trunca y devuelve lo descartado', () => {
    expect(adaptarEntry('12.75', 'COP')).toEqual({ entry: '12', descartados: '75' });
    expect(adaptarEntry('12.', 'COP')).toEqual({ entry: '12', descartados: '' });
  });
  it('sin decimales, o hacia una moneda con decimales, no cambia nada', () => {
    expect(adaptarEntry('45000', 'COP')).toEqual({ entry: '45000', descartados: '' });
    expect(adaptarEntry('12.75', 'EUR')).toEqual({ entry: '12.75', descartados: '' });
    expect(adaptarEntry('4500', 'USD')).toEqual({ entry: '4500', descartados: '' });
  });
});

describe('montoParaCampo', () => {
  it('reformatea sin perder valor', () => {
    expect(montoParaCampo('12.00', 'COP')).toBe('12');
    expect(montoParaCampo('45000', 'USD')).toBe('45000.00');
    expect(montoParaCampo('12,5', 'EUR')).toBe('12.50');
  });
  it('si perdería decimales, deja el texto para que la validación lo señale', () => {
    expect(montoParaCampo('12.50', 'COP')).toBe('12.50');
    expect(montoParaCampo('abc', 'USD')).toBe('abc');
  });
});
