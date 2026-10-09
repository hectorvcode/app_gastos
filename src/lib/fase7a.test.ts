import { describe, expect, it } from 'vitest';
import { textoDescarga } from './exportar';
import { edicionTieneCambios, type CamposEdicion } from './historial';

describe('aviso de descarga', () => {
  it('en el celular dice dónde quedó el archivo y cómo subirlo a Drive', () => {
    expect(textoDescarga('gastos_20261008-203734.csv', true)).toBe(
      'Se guardó gastos_20261008-203734.csv en Archivos → Descargas. Para subirlo a Drive: abre Files, mantén presionado el archivo → Compartir → Drive.',
    );
  });

  it('en escritorio conserva el aviso de siempre', () => {
    expect(textoDescarga('gastos_20261008-203734.csv', false)).toBe(
      'Se descargó gastos_20261008-203734.csv en tu carpeta de descargas. No puedo saber si llegó a su destino.',
    );
  });
});

describe('edicionTieneCambios (Atrás pregunta solo si hay algo sin guardar)', () => {
  const inicial: CamposEdicion = {
    monto: '45000',
    fecha: '2026-10-07',
    hora: '13:42',
    moneda: 'COP',
    categoriaId: 'comida',
    cuentaId: 'personal',
    nota: 'Almuerzo',
  };

  it('sin tocar nada no hay cambios', () => {
    expect(edicionTieneCambios(inicial, { ...inicial }, false)).toBe(false);
  });

  it('cada campo cuenta', () => {
    for (const cambio of [
      { monto: '46000' },
      { fecha: '2026-10-06' },
      { hora: '14:00' },
      { moneda: 'USD' },
      { categoriaId: 'salud' },
      { cuentaId: 'hogar' },
      { nota: 'Cena' },
    ]) {
      expect(edicionTieneCambios(inicial, { ...inicial, ...cambio }, false)).toBe(true);
    }
  });

  it('una foto nueva, quitada o en proceso cuenta', () => {
    expect(edicionTieneCambios(inicial, { ...inicial }, true)).toBe(true);
  });

  it('espacios sobrantes en la nota y coma por punto en el monto no son cambios', () => {
    expect(edicionTieneCambios(inicial, { ...inicial, nota: ' Almuerzo ' }, false)).toBe(false);
    expect(edicionTieneCambios({ ...inicial, monto: '12.50' }, { ...inicial, monto: '12,50' }, false)).toBe(false);
  });
});
