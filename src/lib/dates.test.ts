import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildFechaIso,
  dateKey,
  dayMonthLabel,
  formatDdMmAaaa,
  isFuture,
  shortLabel,
} from './dates';

describe('fechas', () => {
  const ahora = new Date(2026, 9, 7, 13, 42); // 7 oct 2026, hora local

  it('dateKey usa la fecha local', () => {
    expect(dateKey(ahora)).toBe('2026-10-07');
  });
  it('addDays cruza meses y años', () => {
    expect(addDays('2026-10-07', -2)).toBe('2026-10-05');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('etiquetas en español', () => {
    expect(shortLabel('2026-10-05')).toBe('Lun 5 oct');
    expect(dayMonthLabel('2026-10-05')).toBe('5 oct');
    expect(formatDdMmAaaa('2026-10-05')).toBe('05/10/2026');
  });
  it('hoy conserva la hora actual', () => {
    expect(buildFechaIso('2026-10-07', ahora)).toBe(ahora.toISOString());
  });
  it('otro día se guarda a las 12:00 locales', () => {
    const d = new Date(buildFechaIso('2026-10-05', ahora));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 9, 5, 12, 0,
    ]);
  });
  it('detecta fechas futuras', () => {
    expect(isFuture('2026-10-08', ahora)).toBe(true);
    expect(isFuture('2026-10-07', ahora)).toBe(false);
  });
});
