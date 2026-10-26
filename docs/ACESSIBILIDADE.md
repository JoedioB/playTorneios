# Roteiro de auditoria de acessibilidade (manual)

Alvo: WCAG 2.2 AA. O que dá para automatizar já roda no CI (`pnpm test:web`: rótulos, h1, landmarks, reflow em 320 px e axe-core nas 14 rotas × 2 temas). Este roteiro cobre o que máquina não pega. Use os dados do seed (`pnpm seed --carga`) e preencha a tabela no fim.

## Preparação
- Navegador/leitor: Windows: NVDA + Firefox e NVDA + Chrome. macOS: VoiceOver + Safari. iPhone: VoiceOver + Safari. Android: TalkBack + Chrome (opcional).
- Entre com a conta do seed e abra a Copa Praia Grande (tem empate em aberto, partida ao vivo, lista de espera e correção).
- Anote em cada falha: tela, passo, o que o leitor falou, o que esperava.

## Fluxos (cada um só com teclado, depois com leitor de tela)
1. **Entrar e abrir o app.** Foco inicial lógico; "Ir para o conteúdo" funciona; erro de login é anunciado.
2. **Registrar um placar** (`Registrar placar`): escolher a partida, digitar os sets, ver o erro de placar inválido em português, salvar. O resultado é anunciado? O foco volta para um lugar previsível?
3. **Corrigir um resultado** com justificativa: o aviso de impacto nas partidas seguintes é lido antes de confirmar.
4. **Inscrições e check-in:** marcar check-in de um lado da dupla; o estado (marcado/desmarcado) é lido.
5. **Gerar e trocar posições na chave:** o diálogo de troca é lido e o foco fica preso nele; Esc fecha e devolve o foco.
6. **Desempate manual** (Feminina, grupo B): o empate em aberto é explicado e o formulário é navegável.
7. **Agenda:** tabela com cabeçalhos lidos por célula; conflito de agenda é anunciado, não só colorido.
8. **Trocar torneio:** diálogo "Seus torneios", aviso de pendências (`role=alert`).
9. **Sincronização:** mudar para offline (modo avião) e voltar; o chip e a região viva anunciam sem repetir demais (debounce de 2 s).
10. **Bloqueio por PIN:** o diálogo anuncia o título, o erro de PIN incorreto é lido.
11. **Página pública** (`/p/<slug>`): navegação por cabeçalhos e landmarks; tabela de classificação com legenda; placar ao vivo não interrompe a leitura.

## Zoom, reflow e preferências
- **Zoom 200% e 400%** (Ctrl +) em 1280 px: nada some, nada sobrepõe, sem rolagem horizontal fora de tabelas. Teste Central, Resultados, Chaves e Agenda.
- **Apenas texto maior** (Firefox: Exibir > Zoom > Somente texto) a 200%.
- **Espaçamento de texto** (bookmarklet "Text Spacing"): sem corte nem sobreposição.
- **Modo sol** (alto contraste claro) e tema escuro: ler à luz forte, bordas e estados visíveis.
- **Windows Alto Contraste / forced-colors:** botões, badges e foco continuam visíveis.
- **Reduzir movimento** (SO): sem animações essenciais.
- **Alvos de toque:** mínimo de 24×24 px (idealmente 44) nos botões de placar, no celular de verdade, ao sol se possível.

## Critérios de aprovação
- Nenhum bloqueio (não consegue concluir o fluxo) em nenhum leitor.
- Estados nunca só por cor (badge tem ícone e texto; confirmar no modo sol).
- Todo erro e confirmação é anunciado sem o usuário procurar.
- Foco nunca se perde (volta ao botão de origem ao fechar diálogos).

## Registro
| Data | Fluxo | Navegador + leitor | Resultado (OK/falha) | Observação / issue |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
