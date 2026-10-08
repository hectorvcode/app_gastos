import { describe, expect, it } from 'vitest';
import { applyKey, decimalsFor, entryToNumber, formatEntry, formatMonto, type Key } from './money';

const teclear = (keys: Key[], moneda = 'COP'): string =>
  keys.reduce((acc, k) => applyKey(acc, k, moneda), '');

describe('decimalsFor', () => {
  it('COP sin decimales; USD y EUR con 2', () => {
    expect(decimalsFor('COP')).toBe(0);
    expect(decimalsFor('USD')).toBe(2);
    expect(decimalsFor('EUR')).toBe(2);
  });
});

describe('applyKey', () => {
  it('arma el monto dígito a dígito', () => {
    expect(teclear(['4', '5', '0', '0', '0'])).toBe('45000');
  });
  it('"00" agrega dos ceros pero no sobre un monto vacío', () => {
    expect(teclear(['00'])).toBe('');
    expect(teclear(['4', '5', '00'])).toBe('4500');
  });
  it('no acepta ceros a la izquierda', () => {
    expect(teclear(['0', '0', '7'])).toBe('7');
  });
  it('borra el último dígito', () => {
    expect(teclear(['1', '2', 'back'])).toBe('1');
    expect(teclear(['back'])).toBe('');
  });
  it('COP ignora el punto decimal', () => {
    expect(teclear(['1', '.', '5'])).toBe('15');
  });
  it('USD admite hasta 2 decimales', () => {
    expect(teclear(['1', '2', '.', '5', '0', '9'], 'USD')).toBe('12.50');
    expect(teclear(['.', '5'], 'USD')).toBe('0.5');
  });
  it('limita la parte entera', () => {
    expect(teclear(Array(12).fill('9') as Key[])).toBe('999999999');
  });
});

describe('formateo', () => {
  it('formatEntry usa punto de miles y coma decimal', () => {
    expect(formatEntry('')).toBe('0');
    expect(formatEntry('45000')).toBe('45.000');
    expect(formatEntry('1234567')).toBe('1.234.567');
    expect(formatEntry('12.5')).toBe('12,5');
  });
  it('formatMonto respeta decimales por moneda', () => {
    expect(formatMonto(45000, 'COP')).toBe('45.000');
    expect(formatMonto(12.5, 'USD')).toBe('12,50');
    expect(formatMonto(1000, 'EUR')).toBe('1.000,00');
  });
  it('entryToNumber', () => {
    expect(entryToNumber('')).toBe(0);
    expect(entryToNumber('12.5')).toBe(12.5);
  });
});
