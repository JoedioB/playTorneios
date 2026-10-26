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
      const file = path.join(root, decodeURIComponent((req.url || '/').split('?')[0]));
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

  // Quadras
  await page.goto(base + '/index.html#/quadras');
  for (const n of ['Quadra 1', 'Quadra 2']) {
    await page.getByLabel('Nome da nova quadra').fill(n);
    await page.getByRole('button', { name: 'Adicionar quadra' }).click();
    await page.getByText(n, { exact: true }).first().waitFor();
  }
  log('quadras');

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
    await page.getByLabel('Inscrever já em uma categoria (opcional)').selectOption({ label: 'Aberta' });
    await page.getByRole('button', { name: 'Criar dupla' }).click();
    await page.getByText(`Atleta ${i}A / Atleta ${i}B`).waitFor();
  }
  log('4 duplas inscritas');

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
