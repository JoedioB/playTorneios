// Teste de fumaça no Chromium: percorre o fluxo completo do organizador com o app real.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
// Uso: node smoke.cjs [URL_BASE] [PASTA_DE_CAPTURAS]. Sem argumentos, serve a pasta .smoke da raiz do repositório.
let base = process.argv[2];
const shots = process.argv[3] || path.join(__dirname, '..', '..', '..', '.smoke', 'shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  let server;
  if (!base) {
    const root = path.join(__dirname, '..', '..', '..', '.smoke');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
    server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(root, url.startsWith('/p/') ? 'public.html' : url); // /p/<slug> = página pública (nginx faz o mesmo)
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const log = (s) => console.log('✔', s);

  await page.goto(base + '/index.html');
  await page.getByRole('heading', { name: 'Criar torneio' }).waitFor();
  await page.getByLabel('Nome do torneio').fill('Open de Verão');
  await page.getByLabel('Cidade').fill('Natal');
  await page.getByLabel('Local (arena ou praia)').fill('Praia de Ponta Negra');
  await page.getByLabel('Data inicial').fill('2026-11-07');
  await page.getByLabel('Data final').fill('2026-11-08');
  await page.getByRole('button', { name: 'Criar torneio' }).click();
  await page.getByRole('heading', { name: 'Central', exact: true }).waitFor();
  log('torneio criado (offline-first, sem servidor de dados)');

  // Navegação: ordem do ciclo de vida, aviso de pré-requisito e próximo passo na Central
  const nav = page.getByRole('navigation', { name: 'Principal' });
  assert.deepEqual(
    await nav.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href'))),
    ['#/', '#/torneio', '#/quadras', '#/categorias', '#/duplas', '#/inscricoes', '#/chaves', '#/agenda', '#/resultados', '#/juizes', '#/telao', '#/imprimir', '#/publico', '#/relatorios', '#/encerramento', '#/sync', '#/sistema'],
    'ordem do menu = ciclo de vida do torneio');
  assert.equal(await nav.locator('[aria-current="page"]').count(), 1, 'um único item com aria-current');
  await nav.getByRole('link', { name: /^Chaves/ }).getByText('Crie categorias antes').waitFor();
  await page.locator('li.step[aria-current="step"]').getByText('Quadras', { exact: true }).waitFor();
  log('menu na ordem do ciclo de vida; Central aponta o próximo passo (Quadras)');

  // Quadras
  await page.goto(base + '/index.html#/quadras');
  for (const n of ['Quadra 1', 'Quadra 2']) {
    await page.getByLabel('Nome da nova quadra').fill(n);
    await page.getByRole('button', { name: 'Adicionar quadra' }).click();
    await page.getByText(n, { exact: true }).first().waitFor();
  }
  log('quadras');
  await page.goto(base + '/index.html#/');
  await page.locator('li.step[aria-current="step"]').getByText('Categorias e regras', { exact: true }).waitFor();
  log('Central avança o próximo passo para Categorias');

  // Categoria
  await page.goto(base + '/index.html#/categorias');
  await page.getByRole('button', { name: 'Nova categoria' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Aberta');
  await page.getByRole('button', { name: 'Salvar categoria' }).click();
  await page.getByRole('heading', { name: 'Aberta' }).waitFor();
  log('categoria');

  // Duplas
  await page.goto(base + '/index.html#/duplas');
  for (let i = 1; i <= 4; i++) {
    await page.getByRole('button', { name: 'Nova dupla' }).click();
    const names = page.getByLabel('Nome completo');
    await names.nth(0).fill(`Atleta ${i}A`);
    await names.nth(1).fill(`Atleta ${i}B`);
    // A 4ª dupla é criada sem categoria e inscrita depois, pelo botão "Inscrever" (antes ficava sem saída).
    if (i < 4) await page.getByLabel('Inscrever já em uma categoria (opcional)').selectOption({ label: 'Aberta' });
    await page.getByRole('button', { name: 'Criar dupla' }).click();
    await page.getByText(`Atleta ${i}A / Atleta ${i}B`).waitFor();
  }
  await page.getByText('Sem inscrição').waitFor();
  await page.getByRole('button', { name: /^Inscrever Atleta 4A \/ Atleta 4B/ }).click();
  await page.getByRole('dialog').getByLabel('Categoria').selectOption({ label: 'Aberta' });
  await page.getByRole('dialog').getByRole('button', { name: 'Inscrever', exact: true }).click();
  await page.getByText('Inscrição criada como pendente.').waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes('Sem inscrição'));
  log('4 duplas inscritas (uma delas depois da criação)');

  // Inscrições
  await page.goto(base + '/index.html#/inscricoes');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Aprovar' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('button').length > 0 && ![...document.querySelectorAll('button')].some((b) => b.textContent === 'Aprovar'));
  log('inscrições aprovadas');

  // Chave
  await page.goto(base + '/index.html#/chaves');
  await page.getByRole('button', { name: 'Gerar chave' }).first().click();
  await page.getByLabel('Semente do sorteio (opcional)').fill('42');
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar chave' }).click();
  await page.getByText('Semifinal · jogo 1').first().waitFor();
  assert.equal(await page.locator('article.mcard').count(), 3);
  await page.screenshot({ path: shots + '/chaves.png', fullPage: true });
  log('chave gerada com semente 42 (3 partidas)');

  // Trocar posições (sem resultados: aplica direto)
  await page.getByRole('button', { name: 'Trocar posições' }).click();
  await page.getByLabel('Primeira posição').selectOption({ index: 1 });
  await page.getByLabel('Segunda posição').selectOption({ index: 2 });
  await page.getByRole('dialog').getByRole('button', { name: 'Trocar', exact: true }).click();
  await page.getByText('Posições trocadas.').waitFor();
  log('posições trocadas na chave (com auditoria)');

  // Agenda
  await page.goto(base + '/index.html#/agenda');
  await page.getByRole('button', { name: 'Gerar proposta' }).click();
  await page.getByRole('dialog').getByText(/Proposta: 3 partida/).waitFor();
  await page.getByRole('button', { name: 'Aplicar proposta' }).click();
  await page.getByRole('table').first().waitFor();
  assert.equal(await page.getByText('Conflito de horário').count(), 0);
  await page.screenshot({ path: shots + '/agenda.png', fullPage: true });
  log('agenda proposta e aplicada sem conflitos');

  // Placar de quadra: iniciar, lançar pontos, desfazer, finalizar pela tela cheia
  await page.goto(base + '/index.html#/');
  await page.getByRole('button', { name: 'Iniciar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Abrir placar' }).first().click();
  await page.getByRole('button', { name: /^Ponto para / }).first().waitFor();
  const plus = (i) => page.getByRole('button', { name: /^Ponto para / }).nth(i);
  for (let i = 0; i < 3; i++) await plus(0).click();
  await page.getByRole('button', { name: 'Desfazer último ponto' }).click();
  await page.getByRole('button', { name: 'Desfazer último ponto' }).click();
  await page.getByRole('button', { name: 'Desfazer último ponto' }).click();
  assert.equal(await page.getByRole('button', { name: 'Desfazer último ponto' }).isDisabled(), true);
  for (let i = 0; i < 10; i++) await plus(1).click();
  for (let i = 0; i < 18; i++) await plus(0).click();
  await page.getByText(/Sets 1 × 0/).waitFor();
  for (let i = 0; i < 12; i++) await plus(1).click();
  for (let i = 0; i < 18; i++) await plus(0).click();
  await page.getByRole('heading', { name: /venceu$/ }).waitFor();
  assert.equal(await plus(0).isDisabled(), true, 'depois de decidida a partida, os botões de ponto travam');
  await page.getByRole('button', { name: 'Finalizar partida' }).click();
  await page.getByRole('button', { name: 'Confirmar placar' }).click();
  await page.getByText('Resultado registrado.').first().waitFor();
  log('placar de quadra: pontos, desfazer e finalização pelo próprio placar');
  await page.goto(base + '/index.html#/telao');
  await page.getByRole('heading', { name: 'Quadra 1' }).waitFor();
  await page.goto(base + '/index.html#/imprimir');
  await page.getByRole('article', { name: /^Súmula/ }).first().waitFor();
  log('telão e súmulas para impressão abrem');

  // Resultados
  await page.goto(base + '/index.html#/resultados');
  const play = async (a1, b1, a2, b2) => {
    await page.getByRole('button', { name: /^Registrar placar de/ }).first().click();
    const d = page.getByRole('dialog');
    await d.getByLabel(/— set 1$/).nth(0).fill(String(a1)); await d.getByLabel(/— set 1$/).nth(1).fill(String(b1));
    await d.getByLabel(/— set 2$/).nth(0).fill(String(a2)); await d.getByLabel(/— set 2$/).nth(1).fill(String(b2));
    await d.getByRole('button', { name: 'Salvar resultado' }).click();
    await d.waitFor({ state: 'hidden' });
  };
  // placar inválido primeiro
  await page.getByRole('button', { name: /^Registrar placar de/ }).first().click();
  let d = page.getByRole('dialog');
  await d.getByLabel(/— set 1$/).nth(0).fill('18'); await d.getByLabel(/— set 1$/).nth(1).fill('17');
  await d.getByLabel(/— set 2$/).nth(0).fill('18'); await d.getByLabel(/— set 2$/).nth(1).fill('5');
  await d.getByRole('button', { name: 'Salvar resultado' }).click();
  await d.getByRole('alert').filter({ hasText: /diferença|terminar|Terminando/i }).waitFor();
  log('placar inválido é explicado em português');
  await d.getByRole('button', { name: 'Cancelar' }).click();
  await play(10, 18, 12, 18);
  await page.getByRole('button', { name: /^Registrar placar de Final/ }).waitFor();
  await page.getByRole('button', { name: /^Registrar placar de Final/ }).click();
  d = page.getByRole('dialog');
  await d.getByLabel(/— set 1$/).nth(0).fill('18'); await d.getByLabel(/— set 1$/).nth(1).fill('15');
  await d.getByLabel(/— set 2$/).nth(0).fill('19'); await d.getByLabel(/— set 2$/).nth(1).fill('17');
  await d.getByRole('button', { name: 'Salvar resultado' }).click();
  await page.getByRole('heading', { name: 'Pódio' }).waitFor();
  await page.screenshot({ path: shots + '/resultados.png', fullPage: true });
  log('final registrada e pódio exibido');

  // correção exige justificativa
  await page.getByRole('button', { name: /^Corrigir/ }).first().click();
  d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Corrigir resultado' }).click();
  await d.getByText(/mínimo de 10 caracteres/).first().waitFor();
  await d.getByRole('button', { name: 'Cancelar' }).click();
  log('correção sem justificativa é recusada');

  // sincronização: servidor idêntico ao cliente
  await page.waitForFunction(() => window.__rt.engine.outbox.length === 0, null, { timeout: 15000 });
  const same = await page.evaluate(() => {
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
    return canon(window.__rt.engine.state) === canon(window.__store.states.get(window.__rt.state.tournament.id));
  });
  assert.ok(same, 'servidor e cliente divergem');
  log('cliente e servidor idênticos, fila vazia');

  // offline → pendente → online
  await page.evaluate(() => { window.__flags.offline = true; });
  await page.getByText(/Offline/).first().waitFor({ timeout: 8000 });
  await page.goto(base + '/index.html#/quadras');
  await page.getByLabel('Nome da nova quadra').fill('Quadra 3');
  await page.getByRole('button', { name: 'Adicionar quadra' }).click();
  await page.getByText('Quadra 3', { exact: true }).first().waitFor();
  assert.ok(await page.evaluate(() => window.__rt.engine.outbox.length >= 1));
  log('offline: alteração salva localmente e mantida na fila');
  await page.evaluate(() => { window.__flags.offline = false; });
  await page.waitForFunction(() => window.__rt.engine.outbox.length === 0, null, { timeout: 20000 });
  await page.getByText('Online').first().waitFor();
  log('volta a rede: fila esvaziada automaticamente');

  // página pública
  await page.goto(base + '/index.html#/publico');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByText('Pré-visualização').waitFor();
  const pubText = await page.locator('.preview-light').innerText();
  assert.ok(/Atleta 1A/.test(pubText) && !/84999/.test(pubText));
  log('página pública publicada e pré-visualizada');
  assert.ok(await page.getByRole('button', { name: 'Sair', exact: true }).first().isVisible(), 'o botão Sair deve estar visível no cabeçalho');
  log('botão "Sair" visível no cabeçalho');

  // acessibilidade básica em todas as rotas
  const routes = ['', 'agenda', 'chaves', 'resultados', 'inscricoes', 'duplas', 'categorias', 'quadras', 'juizes', 'imprimir', 'torneio', 'publico', 'relatorios', 'encerramento', 'sync', 'sistema'];
  for (const r of routes) {
    await page.goto(`${base}/index.html#/${r}`);
    await page.waitForTimeout(150);
    const res = await page.evaluate(() => {
      const bad = [];
      const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length) || el.textContent.trim() || el.getAttribute('title'));
      for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) if (!name(el)) bad.push('campo sem rótulo: ' + el.outerHTML.slice(0, 80));
      for (const el of document.querySelectorAll('button, a[href]')) if (!name(el)) bad.push('botão/link sem nome: ' + el.outerHTML.slice(0, 80));
      const h1 = document.querySelectorAll('h1').length;
      if (h1 !== 1) bad.push('h1 = ' + h1);
      if (!document.querySelector('main#conteudo')) bad.push('sem main');
      if (!document.querySelector('[role=status][aria-live=polite]')) bad.push('sem região viva');
      for (const t of document.querySelectorAll('table')) if (!t.querySelector('caption')) bad.push('tabela sem caption');
      return bad;
    });
    assert.deepEqual(res, [], `rota #/${r}: ${res.join(' | ')}`);
  }
  log('a11y básica em ' + routes.length + ' rotas (rótulos, h1, landmarks, caption, região viva)');

  // Reflow (WCAG 1.4.10): em 320 px de largura (equivale a 400% de zoom) nenhuma rota rola na horizontal.
  const vp = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  for (const r of routes) {
    await page.goto(`${base}/index.html#/${r}`);
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > w + 1 && !el.closest('.table-wrap, [data-scroll], pre')).slice(0, 3).map((el) => el.tagName.toLowerCase() + '.' + el.className);
      return { scroll: document.documentElement.scrollWidth - w, wide };
    });
    assert.ok(over.scroll <= 1, `rota #/${r} rola ${over.scroll}px na horizontal em 320px; largos: ${over.wide.join(', ')}`);
  }
  await page.setViewportSize(vp || { width: 1280, height: 800 });
  log('reflow em 320px (400% de zoom) sem rolagem horizontal em ' + routes.length + ' rotas');

  // Menu recolhido em telas estreitas: barra compacta, abre/fecha, navega e fecha ao escolher
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${base}/index.html#/`);
  const menuBtn = page.getByRole('button', { name: 'Menu' });
  assert.equal(await menuBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByRole('navigation', { name: 'Principal' }).isVisible(), false, 'menu fechado em 375px');
  assert.ok((await page.locator('.topbar').boundingBox()).height < 140, 'barra superior compacta em 375px');
  await menuBtn.click();
  assert.equal(await menuBtn.getAttribute('aria-expanded'), 'true');
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: /^Quadras/ }).click();
  await page.getByRole('heading', { name: 'Quadras', exact: true }).waitFor();
  assert.equal(await menuBtn.getAttribute('aria-expanded'), 'false', 'menu fecha ao navegar');
  await page.setViewportSize(vp || { width: 1280, height: 800 });
  log('menu recolhido em 375px: abre, navega e fecha');

  // axe-core (WCAG 2.2 A/AA) nos dois temas. Só roda se @axe-core/playwright estiver instalado (CI instala).
  let AxeBuilder = null;
  try { AxeBuilder = require('@axe-core/playwright').default || require('@axe-core/playwright').AxeBuilder; } catch { /* opcional localmente */ }
  if (!AxeBuilder) {
    console.log('… axe-core não instalado: etapa pulada (pnpm install no repositório instala)');
  } else {
    const report = [];
    for (const contrast of ['dark', 'light']) {
      for (const r of [...routes, 'telao']) {
        await page.goto(`${base}/index.html#/${r}`);
        await page.evaluate((c) => { const r = document.documentElement; r.dataset.contrast = c; if (c === 'light') { r.style.removeProperty('--amber'); r.style.removeProperty('--on-amber'); } }, contrast);
        await page.waitForTimeout(150);
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        for (const v of res.violations) report.push({ tema: contrast, rota: '#/' + r, regra: v.id, impacto: v.impact, ajuda: v.help, alvos: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) });
      }
    }
    require('node:fs').writeFileSync(shots + '/axe-report.json', JSON.stringify(report, null, 2));
    const blocking = report.filter((v) => v.impacto === 'serious' || v.impacto === 'critical');
    assert.deepEqual(blocking, [], 'axe: violações sérias/críticas (relatório completo em axe-report.json):\n' + JSON.stringify(blocking, null, 2));
    log(`axe-core: nenhuma violação séria ou crítica em ${routes.length} rotas × 2 temas (${report.length} menores, ver axe-report.json)`);
  }

  // ------------------------------------------------------------------ página pública (/p/<slug>), com a API simulada
  {
    const { makeSnapshot, P } = await import('./public-fixture.ts');
    const publicPage = async (opts = {}) => {
      const { variant = 'full', vp = [375, 667], scheme = 'light', clock = false, init, status = 200, delay = 0, hash = '' } = opts;
      const c = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, colorScheme: scheme, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: opts.reducedMotion || 'no-preference' });
      const pg = await c.newPage();
      const st = { hits: [], mode: 'ok', snap: makeSnapshot(Date.now(), variant), status };
      const perrs = [];
      pg.on('pageerror', (e) => perrs.push(e.message));
      const origins = new Set();
      pg.on('request', (r) => origins.add(new URL(r.url()).origin));
      if (init) await pg.addInitScript(init);
      if (clock) await pg.clock.install({ time: Date.now() });
      await pg.route('**/api/public/**', async (r) => {
        st.hits.push(r.request().headers());
        if (delay) await new Promise((res) => setTimeout(res, delay));
        if (st.mode === 'down') return r.abort('failed');
        if (st.status !== 200) return r.fulfill({ status: st.status, contentType: 'application/json', body: '{"error":{"code":"X","message":"x"}}' });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(st.snap) });
      });
      await pg.goto(`${base}/p/copa-teste${hash}`);
      return { c, pg, st, perrs, origins };
    };
    const topics = (pg) => pg.locator('main h2').allInnerTexts();

    // 1) primeira dobra, ordem, landmarks, metas, sem rolagem horizontal
    let { c, pg, perrs, origins } = await publicPage();
    await pg.getByRole('heading', { level: 1, name: 'Copa Teste de Futevôlei' }).waitFor();
    assert.equal(await pg.locator('h1').count(), 1);
    assert.equal(await pg.locator('main').count(), 1);
    assert.equal(await pg.getByRole('search').count(), 1, 'busca em landmark search');
    assert.equal(await pg.title(), 'Copa Teste de Futevôlei — Natal');
    assert.ok(await pg.locator('meta[name=description]').count() && await pg.locator('meta[name=theme-color]').count(), 'meta description e theme-color');
    const live = await pg.locator('.pv-m.live').first().boundingBox();
    assert.ok(live && live.y + live.height <= 667, `jogo ao vivo precisa caber na primeira dobra de 375×667 (fim em ${live && Math.round(live.y + live.height)} px)`);
    await pg.getByLabel('Encontrar minha dupla').waitFor();
    const order = (await topics(pg)).map((t) => t.trim());
    const idx = (t) => order.findIndex((x) => x.includes(t));
    assert.ok(idx('Ao vivo agora') >= 0 && idx('Ao vivo agora') < idx('Próximos jogos') && idx('Próximos jogos') < idx('Masculina Open'), 'ordem: ao vivo → próximos → categoria; veio: ' + order.join(' | '));
    for (const w of [375, 320]) {
      await pg.setViewportSize({ width: w, height: 640 });
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1, `página pública rola na horizontal em ${w}px`);
    }
    await pg.setViewportSize({ width: 375, height: 667 });
    const a11y = await pg.evaluate(() => {
      const bad = [];
      const nm = (el) => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length) || el.textContent.trim();
      for (const el of document.querySelectorAll('input, select, button, a[href]')) if (!nm(el)) bad.push('sem nome: ' + el.outerHTML.slice(0, 70));
      for (const t of document.querySelectorAll('table')) if (!t.querySelector('caption') || !t.querySelector('th[scope=col]')) bad.push('tabela sem caption/th');
      if (!document.querySelector('[role=status][aria-live=polite]')) bad.push('sem região viva');
      for (const el of document.querySelectorAll('.pv-btn, .pv-catnav a, input, summary')) { const h = el.getBoundingClientRect().height; if (h && h < 43.5) bad.push('alvo < 44px: ' + el.className + ' ' + Math.round(h)); }
      if (document.querySelector('script:not([src])')) bad.push('script inline (CSP)');
      return bad;
    });
    assert.deepEqual(a11y, [], a11y.join(' | '));
    assert.deepEqual([...origins], [new URL(base).origin], 'a página pública só fala com a própria origem (CSP, sem terceiros)');
    assert.deepEqual(perrs, []);
    await c.close();
    log('página pública: ao vivo na primeira dobra (375×667), ordem das seções, landmarks, metas, 320/375 sem rolagem horizontal, alvos ≥ 44 px, só a própria origem');

    // 2) tema: segue o aparelho; botão troca e lembra
    for (const [scheme, want] of [['dark', 'dark'], ['light', 'light']]) {
      ({ c, pg } = await publicPage({ scheme }));
      await pg.locator('h1').waitFor();
      assert.equal(await pg.evaluate(() => document.documentElement.dataset.contrast), want);
      await c.close();
    }
    ({ c, pg } = await publicPage({ scheme: 'dark' }));
    await pg.getByRole('button', { name: 'Modo sol' }).click();
    assert.equal(await pg.evaluate(() => document.documentElement.dataset.contrast), 'light');
    assert.equal(await pg.evaluate(() => localStorage.getItem('pt:contrast')), 'light');
    await pg.reload();
    await pg.getByRole('button', { name: 'Tema escuro' }).waitFor();
    await c.close();
    log('página pública: tema segue o aparelho (escuro/claro), "Modo sol" troca e é lembrado');

    // 3) buscar, seguir ("meu jogo"), lembrar, deixar de seguir; sem armazenamento não quebra
    ({ c, pg } = await publicPage());
    await pg.getByLabel('Encontrar minha dupla').fill('thiago');
    await pg.getByText('1 dupla encontrada.').waitFor();
    assert.equal(await pg.locator('.pv-pair').count(), 1);
    assert.ok((await pg.locator('.pv-pair').innerText()).includes(P.b));
    await pg.getByLabel('Encontrar minha dupla').fill('zzz');
    await pg.getByText(/Nenhuma dupla encontrada/).waitFor();
    await pg.getByLabel('Encontrar minha dupla').fill('MATEUS');
    const follow = pg.getByRole('button', { name: `Seguir ${P.a}` });
    assert.equal(await follow.getAttribute('aria-pressed'), 'false');
    await follow.click();
    assert.equal(await follow.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await pg.evaluate(() => JSON.parse(localStorage.getItem('pt:fav'))), { 'copa-teste': [P.a] });
    await pg.getByLabel('Encontrar minha dupla').fill('');
    await pg.getByRole('heading', { name: 'Meus jogos' }).waitFor();
    const order2 = (await topics(pg)).map((t) => t.trim());
    assert.equal(order2[0], 'Meus jogos', '"Meus jogos" vem antes de tudo: ' + order2.join(' | '));
    assert.ok(await pg.getByText('Seu jogo').count() >= 1);
    await pg.reload();
    await pg.getByRole('heading', { name: 'Meus jogos' }).waitFor();
    await pg.getByRole('button', { name: `Seguir ${P.a}` }).click();
    await pg.getByRole('heading', { name: 'Meus jogos' }).waitFor({ state: 'detached' });
    assert.equal(await pg.evaluate(() => localStorage.getItem('pt:fav')), '{}');
    await c.close();
    ({ c, pg, perrs } = await publicPage({ init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); } }));
    await pg.getByLabel('Encontrar minha dupla').fill('mateus');
    await pg.getByRole('button', { name: `Seguir ${P.a}` }).click();
    assert.equal(await pg.getByRole('button', { name: `Seguir ${P.a}` }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(perrs, [], 'sem localStorage a página continua funcionando');
    await c.close();
    log('página pública: busca por nome/sobrenome, "Seguir" (só no aparelho), "Meus jogos" no topo, lembra ao recarregar, funciona sem localStorage');

    // 4) categorias: seletor, link compartilhável, 1 categoria sem seletor
    ({ c, pg } = await publicPage());
    const nav = pg.getByRole('navigation', { name: 'Categorias' });
    assert.equal(await nav.getByRole('link', { name: /Masculina Open/ }).getAttribute('aria-current'), 'true', 'abre na categoria com jogo ao vivo');
    await nav.getByRole('link', { name: 'Mista Iniciante' }).click();
    await pg.getByRole('heading', { level: 2, name: 'Mista Iniciante' }).waitFor();
    assert.equal(new URL(pg.url()).hash, '#categoria-cat-b');
    await c.close();
    ({ c, pg } = await publicPage({ hash: '#categoria-cat-b' }));
    await pg.getByRole('heading', { level: 2, name: 'Mista Iniciante' }).waitFor();
    await c.close();
    ({ c, pg } = await publicPage({ variant: 'single' }));
    await pg.locator('h1').waitFor();
    assert.equal(await pg.getByRole('navigation', { name: 'Categorias' }).count(), 0, 'com 1 categoria não há seletor');
    await pg.getByRole('heading', { level: 3, name: 'Mata-mata' }).waitFor();
    await pg.getByRole('table').first().waitFor();
    await c.close();
    for (const w of [320, 375]) { // 8 categorias (com "ao vivo"): a faixa rola sozinha, a página não
      ({ c, pg } = await publicPage({ variant: 'many', vp: [w, 640] }));
      await pg.getByRole('navigation', { name: 'Categorias' }).waitFor();
      assert.equal(await pg.getByRole('navigation', { name: 'Categorias' }).getByRole('link').count(), 8);
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1, `8 categorias alargam a página em ${w}px`);
      assert.ok(await pg.evaluate(() => { const u = document.querySelector('.pv-catnav ul'); return u.scrollWidth > u.clientWidth; }), 'a faixa de categorias rola na horizontal');
      await c.close();
    }
    log('página pública: seletor de categorias, link #categoria-<id> compartilhável, sem seletor com 1 categoria');

    // 5) estados: vazio, encerrado, sem agenda, 404, erro inicial, carregando
    ({ c, pg } = await publicPage({ variant: 'empty' }));
    await pg.getByText(/Ainda não há chaves, horários ou resultados/).waitFor();
    await pg.getByText('Em preparação').first().waitFor();
    await c.close();
    ({ c, pg } = await publicPage({ variant: 'closed' }));
    await pg.getByText('Torneio encerrado').waitFor();
    await pg.getByRole('heading', { name: 'Campeões' }).waitFor();
    await pg.getByRole('heading', { name: 'Pódio' }).waitFor();
    assert.equal(await pg.getByRole('heading', { name: 'Ao vivo agora' }).count(), 0);
    await c.close();
    ({ c, pg } = await publicPage({ variant: 'no-schedule' }));
    await pg.getByRole('heading', { name: 'Próximos jogos' }).waitFor();
    const txt = await pg.locator('body').innerText();
    assert.ok(!/Invalid|NaN|undefined|null/.test(txt), 'sem "Invalid Date/NaN/undefined" quando a agenda está desligada');
    await c.close();
    ({ c, pg } = await publicPage({ status: 404 }));
    await pg.getByRole('heading', { name: 'Torneio não encontrado' }).waitFor();
    await c.close();
    ({ c, pg } = await publicPage({ status: 500 }));
    await pg.getByRole('heading', { name: 'Sem conexão' }).waitFor();
    await pg.getByRole('button', { name: 'Tentar agora' }).waitFor();
    await c.close();
    ({ c, pg } = await publicPage({ delay: 600 }));
    await pg.locator('[aria-busy="true"]').waitFor();
    await pg.locator('h1', { hasText: 'Copa Teste' }).waitFor();
    await c.close();
    log('página pública: estados vazio, encerrado (campeões + pódio), sem agenda, 404, erro inicial com "Tentar agora" e carregando');

    // 6) tempo real: consulta a cada ~15 s revalidando, sem pular a tela, sem conexão → aviso, volta → some
    ({ c, pg, st: _st } = await (async () => { const r = await publicPage({ clock: true, init: () => { const f = window.fetch.bind(window); window.__cache = []; window.fetch = (u, i) => { window.__cache.push(i && i.cache); return f(u, i); }; } }); return { ...r, st: r.st }; })());
    const st = _st;
    await pg.locator('h1').waitFor();
    assert.ok(st.hits.length >= 1);
    await pg.getByText(/conferido agora/).waitFor();
    // muda só o placar ao vivo (abaixo da dobra): nada de remontar, a rolagem continua onde estava
    await pg.evaluate(() => { window.scrollTo(0, 300); document.querySelector('.pv-m.live').dataset.marca = 'x'; });
    const y0 = await pg.evaluate(() => scrollY);
    st.snap = { ...st.snap, generatedAt: new Date(Date.now() + 1000).toISOString(), categories: st.snap.categories.map((cat) => ({ ...cat, matches: cat.matches?.map((m) => (m.id === 'a-s2' ? { ...m, live: { a: 10, b: 7 } } : m)) })) };
    const before = st.hits.length;
    await pg.clock.runFor(16000);
    await pg.waitForFunction(() => document.querySelector('.pv-m.live .pv-pt.cur')?.textContent === '10');
    assert.ok(st.hits.length > before, 'consultou de novo em ~15 s');
    assert.equal(await pg.evaluate(() => window.__cache.at(-1)), 'no-cache', 'revalida em vez de usar o cache HTTP (ETag → 304 barato)');
    assert.equal(await pg.evaluate(() => document.querySelector('.pv-m.live').dataset.marca), 'x', 'o cartão não foi recriado');
    assert.equal(await pg.evaluate(() => scrollY), y0, 'a tela não pulou ao atualizar');
    // anúncio discreto: só de quem se segue
    await pg.getByLabel('Encontrar minha dupla').fill('camila');
    await pg.getByRole('button', { name: `Seguir ${P.e}` }).click();
    await pg.getByLabel('Encontrar minha dupla').fill('');
    st.snap = { ...st.snap, generatedAt: new Date(Date.now() + 2000).toISOString(), categories: st.snap.categories.map((cat) => ({ ...cat, matches: cat.matches?.map((m) => (m.id === 'b-f' ? { ...m, status: 'in_progress', live: { a: 0, b: 0 } } : m)) })) };
    await pg.clock.runFor(16000);
    await pg.waitForFunction(() => /Começou o jogo de/.test(document.querySelector('.pv ~ .sr-only[role=status], .pv > .sr-only[role=status]')?.textContent || ''));
    // sem conexão: mantém os dados e avisa; ao voltar, o aviso some
    st.mode = 'down';
    await pg.clock.runFor(16000); await pg.clock.runFor(31000);
    await pg.getByText(/Sem conexão\. Mostrando dados das \d\d:\d\d/).waitFor();
    assert.ok(await pg.locator('.pv-m.live').count() >= 1, 'os dados continuam na tela offline');
    st.mode = 'ok';
    await pg.clock.runFor(61000);
    await pg.getByText(/Sem conexão\. Mostrando dados/).waitFor({ state: 'detached' });
    await c.close();
    log('página pública: consulta ~15 s com revalidação, sem remontar nem pular a tela, anúncio só dos jogos seguidos, aviso "Sem conexão" e recuperação');

    // 7) movimento reduzido
    ({ c, pg } = await publicPage({ reducedMotion: 'reduce' }));
    await pg.locator('.pv-dot').first().waitFor();
    assert.equal(await pg.locator('.pv-dot').first().evaluate((e) => getComputedStyle(e).animationName), 'none');
    await c.close();
    log('página pública: respeita "reduzir movimento"');
  }

  // mobile 375px sem rolagem horizontal da página
  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(base + '/index.html');
  await mp.getByRole('heading', { name: 'Criar torneio' }).waitFor();
  const w = await mp.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 376, 'rolagem horizontal em 375px: ' + w);
  await mp.screenshot({ path: shots + '/mobile.png' });
  log('mobile 375px sem rolagem horizontal');

  // Editar dupla (antes de iniciar partidas, sem confirmação extra)
  await page.goto(base + '/index.html#/duplas');
  await page.getByRole('button', { name: 'Editar Atleta 1A / Atleta 1B' }).click();
  await page.getByLabel('Telefone (opcional)').first().fill('84999990000');
  await page.getByLabel('Nome de exibição da dupla (opcional)').fill('Os Leões');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Os Leões').first().waitFor();
  log('dupla editada (nome de exibição)');

  // Segunda aba no mesmo navegador é barrada (evita dois motores no mesmo banco)
  const second = await ctx.newPage();
  await second.goto(base + '/index.html');
  await second.getByRole('heading', { name: 'O playTorneios já está aberto em outra aba' }).waitFor();
  await second.close();
  log('segunda aba é barrada');

  // Seletor de torneios: lista o torneio aberto e oferece criar outro (sem clicar: trocar recarrega a página).
  await page.goto(base + '/index.html#/');
  await page.getByRole('button', { name: 'Trocar torneio' }).click();
  const sw = page.getByRole('dialog', { name: 'Seus torneios' });
  await sw.getByText('Aberto agora').waitFor();
  await sw.getByRole('button', { name: 'Criar novo torneio' }).waitFor();
  await page.keyboard.press('Escape');
  await sw.waitFor({ state: 'hidden' });
  log('seletor de torneios: mostra o aberto e oferece criar novo');

  // Bloqueio por PIN
  await page.goto(base + '/index.html#/sistema');
  await page.getByLabel('PIN (4 a 8 números)').fill('1234');
  await page.getByRole('button', { name: 'Definir PIN' }).click();
  await page.getByText('PIN ativo').waitFor();
  await page.reload();
  await page.getByRole('dialog', { name: 'App bloqueado' }).waitFor();
  await page.getByLabel('PIN', { exact: true }).fill('9999');
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await page.getByText('PIN incorreto.').waitFor();
  await page.getByLabel('PIN', { exact: true }).fill('1234');
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await page.getByRole('dialog', { name: 'App bloqueado' }).waitFor({ state: 'hidden' });
  await page.evaluate(() => localStorage.removeItem('pt:lock'));
  log('bloqueio por PIN: bloqueia ao abrir, recusa PIN errado, desbloqueia');

  await page.goto(base + '/index.html#/');
  await page.screenshot({ path: shots + '/central.png', fullPage: true });
  assert.deepEqual(errors, [], errors.join('\n'));
  log('sem erros de console');
  await browser.close();
  server?.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
