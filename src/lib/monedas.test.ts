import { describe, expect, it } from 'vitest';
import {
  alternarVisible,
  cargarConfigMonedas,
  cargarMonedaInicial,
  elegirPredeterminada,
  guardarConfigMonedas,
  guardarUltimaMoneda,
  normalizarConfig,
  resolverMonedaAlActivar,
  resolverMonedaInicial,
  type RepoAjustes,
} from './monedas';

function repoEnMemoria(inicial: Record<string, unknown> = {}): RepoAjustes & { datos: Map<string, unknown> } {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    get: async (k) => datos.get(k),
    set: async (k, v) => void datos.set(k, v),
  };
}

const porDefecto = normalizarConfig('COP', ['COP', 'USD', 'EUR']);

describe('monedas visibles', () => {
  it('por defecto: COP predeterminada y COP, USD, EUR visibles', () => {
    expect(normalizarConfig(undefined, undefined)).toEqual(porDefecto);
    expect(porDefecto).toEqual({ predeterminada: 'COP', visibles: ['COP', 'USD', 'EUR'] });
  });
  it('la predeterminada siempre queda visible, aunque falte en la lista', () => {
    expect(normalizarConfig('EUR', ['COP']).visibles).toEqual(['COP', 'EUR']);
    expect(normalizarConfig('USD', []).visibles).toEqual(['USD']);
  });
  it('descarta monedas desconocidas y repetidas', () => {
    expect(normalizarConfig('COP', ['XXX', 'USD', 'USD']).visibles).toEqual(['COP', 'USD']);
  });
  it('no deja ocultar la predeterminada', () => {
    expect(alternarVisible(porDefecto, 'COP').ok).toBe(false);
  });
  it('oculta y muestra monedas no predeterminadas', () => {
    const r1 = alternarVisible(porDefecto, 'EUR');
    expect(r1.ok && r1.config.visibles).toEqual(['COP', 'USD']);
    if (!r1.ok) return;
    const r2 = alternarVisible(r1.config, 'MXN');
    expect(r2.ok && r2.config.visibles).toEqual(['COP', 'USD', 'MXN']);
  });
  it('siempre queda al menos una visible: ocultar todas las demás deja la predeterminada', () => {
    let c = porDefecto;
    for (const m of ['USD', 'EUR']) {
      const r = alternarVisible(c, m);
      if (r.ok) c = r.config;
    }
    expect(c.visibles).toEqual(['COP']);
    expect(alternarVisible(c, 'COP').ok).toBe(false);
  });
  it('al elegir una predeterminada oculta pasa a visible', () => {
    const r = elegirPredeterminada(porDefecto, 'MXN');
    expect(r.ok && r.config).toEqual({ predeterminada: 'MXN', visibles: ['COP', 'USD', 'EUR', 'MXN'] });
  });
  it('rechaza monedas fuera del catálogo', () => {
    expect(elegirPredeterminada(porDefecto, 'XXX').ok).toBe(false);
    expect(alternarVisible(porDefecto, 'XXX').ok).toBe(false);
  });
  it('la configuración se guarda y se vuelve a leer', async () => {
    const repo = repoEnMemoria();
    const r = elegirPredeterminada(porDefecto, 'USD');
    if (!r.ok) throw new Error('inesperado');
    await guardarConfigMonedas(repo, r.config);
    expect(await cargarConfigMonedas(repo)).toEqual(r.config);
  });
});

describe('ultimaMoneda', () => {
  it('sin valor guardado abre con la predeterminada', async () => {
    expect(await cargarMonedaInicial(repoEnMemoria())).toBe('COP');
  });
  it('persiste entre sesiones: lo guardado se recupera al reabrir', async () => {
    const repo = repoEnMemoria();
    await guardarUltimaMoneda(repo, 'USD');
    expect(repo.datos.get('ultimaMoneda')).toBe('USD');
    expect(await cargarMonedaInicial(repo)).toBe('USD');
  });
  it('si la última ya no es visible, vuelve a la predeterminada', async () => {
    const repo = repoEnMemoria({ ultimaMoneda: 'EUR', monedasVisibles: ['COP', 'USD'] });
    expect(await cargarMonedaInicial(repo)).toBe('COP');
    expect(resolverMonedaInicial('EUR', porDefecto)).toBe('EUR');
    expect(resolverMonedaInicial(42, porDefecto)).toBe('COP');
  });
});

describe('moneda de Registrar al volver a la pestaña', () => {
  const cop = normalizarConfig('COP', ['COP', 'USD', 'EUR']);
  it('si Ajustes cambió la predeterminada, Registrar pasa a ella aunque la actual siga visible', () => {
    const nueva = normalizarConfig('USD', ['COP', 'USD', 'EUR']);
    expect(resolverMonedaAlActivar('COP', nueva, 'COP')).toBe('USD');
  });
  it('si la predeterminada no cambió, conserva la moneda elegida en Registrar', () => {
    expect(resolverMonedaAlActivar('EUR', cop, 'COP')).toBe('EUR');
  });
  it('si la moneda en uso quedó oculta, cae en la predeterminada', () => {
    const sinEur = normalizarConfig('COP', ['COP', 'USD']);
    expect(resolverMonedaAlActivar('EUR', sinEur, 'COP')).toBe('COP');
  });
});
