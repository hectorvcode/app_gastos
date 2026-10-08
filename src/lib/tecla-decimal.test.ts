import { describe, expect, it } from 'vitest';
import { applyKey, teclaExtra, type Key } from './money';
import { SesionRegistro } from './registro';

const repo = { add: async () => {}, delete: async () => {} };
const pulsar = (moneda: string, teclas: Key[], inicio = ''): string =>
  teclas.reduce((e, k) => applyKey(e, k, moneda), inicio);

describe('tecla extra según la moneda', () => {
  it('monedas con decimales muestran "," y envían la tecla "."', () => {
    for (const m of ['USD', 'EUR', 'MXN', 'GBP']) {
      expect(teclaExtra(m)).toMatchObject({ key: '.', label: ',' });
    }
  });

  it('monedas sin decimales muestran "00"', () => {
    for (const m of ['COP', 'CLP', 'JPY']) {
      expect(teclaExtra(m)).toMatchObject({ key: '00', label: '00' });
    }
  });

  it('cambiar de moneda en la sesión cambia la tecla de inmediato', () => {
    const s = new SesionRegistro('COP', repo);
    expect(teclaExtra(s.moneda).label).toBe('00');
    s.cambiarMoneda('USD');
    expect(teclaExtra(s.moneda).label).toBe(',');
    s.cambiarMoneda('CLP');
    expect(teclaExtra(s.moneda).label).toBe('00');
  });
});

describe('separador decimal', () => {
  it('admite un solo separador por monto', () => {
    expect(pulsar('USD', ['1', '2', '.', '5', '.'])).toBe('12.5');
    expect(pulsar('USD', ['.', '.'])).toBe('0.');
  });

  it('respeta los 2 decimales de USD/EUR', () => {
    expect(pulsar('USD', ['1', '.', '2', '5', '9'])).toBe('1.25');
    expect(pulsar('EUR', ['7', '.', '0', '5', '1'])).toBe('7.05');
  });

  it('con monto en 0 o vacío, "," da "0,"', () => {
    expect(pulsar('USD', ['.'])).toBe('0.');
    expect(pulsar('USD', ['.'], '0')).toBe('0.');
    expect(pulsar('USD', ['.', '5'])).toBe('0.5');
  });

  it('Backspace borra el separador y luego los dígitos', () => {
    expect(pulsar('USD', ['back'], '12.')).toBe('12');
    expect(pulsar('USD', ['back'], '0.')).toBe('0');
    expect(pulsar('USD', ['back', '.', '7'], '12.5')).toBe('12.7');
  });

  it('en monedas sin decimales la tecla "." no hace nada', () => {
    expect(pulsar('COP', ['1', '.', '5'])).toBe('15');
  });
});

describe('tecla decimal con el aviso de truncado', () => {
  it('USD → COP descarta decimales y restaurar los devuelve, con la tecla "," otra vez', () => {
    const s = new SesionRegistro('USD', repo);
    for (const k of ['1', '2', '.', '5', '0'] as Key[]) s.pulsar(k);
    const cambio = s.cambiarMoneda('COP');
    expect(cambio?.descartados).toBe('50');
    expect(s.entry).toBe('12');
    expect(teclaExtra(s.moneda).label).toBe('00');
    s.restaurarMoneda(cambio!.previa);
    expect(s.entry).toBe('12.50');
    expect(teclaExtra(s.moneda).label).toBe(',');
  });

  it('"12," pasa a COP sin avisar de descarte', () => {
    const s = new SesionRegistro('USD', repo);
    for (const k of ['1', '2', '.'] as Key[]) s.pulsar(k);
    expect(s.cambiarMoneda('COP')?.descartados).toBe('');
    expect(s.entry).toBe('12');
  });
});
