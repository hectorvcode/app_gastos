import { describe, expect, it, vi } from 'vitest';
import { compartirArchivo, esDispositivoMovil } from './compartir';

const archivo = new File(['x'], 'gastos_2026-10-08.csv', { type: 'text/csv' });
const error = (name: string): Error => Object.assign(new Error(name), { name });
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const movil = { userAgent: ANDROID };

describe('esDispositivoMovil', () => {
  it('detecta el celular por userAgentData o por el userAgent (sin contexto seguro no hay userAgentData)', () => {
    expect(esDispositivoMovil({ userAgentData: { mobile: true }, userAgent: WINDOWS })).toBe(true);
    expect(esDispositivoMovil({ userAgentData: { mobile: false }, userAgent: ANDROID })).toBe(false);
    expect(esDispositivoMovil({ userAgent: ANDROID })).toBe(true);
    expect(esDispositivoMovil({ userAgent: WINDOWS })).toBe(false);
    expect(esDispositivoMovil(undefined)).toBe(false);
  });
});

describe('compartirArchivo', () => {
  it('en el escritorio no usa Web Share (el panel de Windows puede dejar la promesa colgada): descarga', async () => {
    const share = vi.fn();
    const canShare = vi.fn(() => true);
    expect(await compartirArchivo(archivo, { userAgent: WINDOWS, share, canShare })).toBe('no-disponible');
    expect(share).not.toHaveBeenCalled();
    expect(canShare).not.toHaveBeenCalled();
  });
  it('sin Web Share (p. ej. http://<IP-LAN>) no está disponible', async () => {
    expect(await compartirArchivo(archivo, undefined)).toBe('no-disponible');
    expect(await compartirArchivo(archivo, movil)).toBe('no-disponible');
  });
  it('si el navegador no acepta archivos, no está disponible y no llama a share', async () => {
    const share = vi.fn();
    expect(await compartirArchivo(archivo, { ...movil, share, canShare: () => false })).toBe('no-disponible');
    expect(share).not.toHaveBeenCalled();
  });
  it('compartido cuando share termina', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await compartirArchivo(archivo, { ...movil, share, canShare: () => true })).toBe('compartido');
    expect(share).toHaveBeenCalledWith({ files: [archivo], title: archivo.name });
  });
  it('cancelado cuando el usuario cierra el menú (AbortError)', async () => {
    const share = vi.fn().mockRejectedValue(error('AbortError'));
    expect(await compartirArchivo(archivo, { ...movil, share, canShare: () => true })).toBe('cancelado');
  });
  it('requiere un toque nuevo cuando Chrome responde NotAllowedError', async () => {
    const share = vi.fn().mockRejectedValue(error('NotAllowedError'));
    expect(await compartirArchivo(archivo, { ...movil, share, canShare: () => true })).toBe('requiere-gesto');
  });
  it('cualquier otro error se propaga', async () => {
    const share = vi.fn().mockRejectedValue(error('DataError'));
    await expect(compartirArchivo(archivo, { ...movil, share, canShare: () => true })).rejects.toThrow('DataError');
  });
});
