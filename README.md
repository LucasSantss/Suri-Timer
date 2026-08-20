# Suri

Extensão de navegador em Manifest V3 que destaca com cor cada cliente da fila de atendimentos (e o nome no painel de detalhes da conversa aberta) de acordo com o tempo de atendimento em andamento. Sem badge/popup na tela — só as cores nos próprios elementos da página.

## Estrutura

- `manifest.json` — manifest da extensão
- `network-interceptor.js` — script principal (MAIN world) que intercepta `fetch`/`XMLHttpRequest`/`WebSocket` para capturar o campo `dateAnswer` de cada conversa retornada pela API
- `content-script.js` — script isolado que lê o painel de detalhes, observa o DOM e aplica a cor no nome do cliente conforme o tempo decorrido
- `selectors.js` — centraliza os seletores e heurísticas para localizar dados da conversa (telefone, painel de detalhes)
- `storage.js` — wrapper para `chrome.storage.sync`
- `options.html` / `options.js` — página de configurações (tema, regras de tempo e domínios)
- `popup.html` / `popup.js` — menu rápido (ícone da extensão) com as mesmas configurações
- `vendor/darkreader.js` — build oficial (UMD) da biblioteca [Dark Reader](https://github.com/darkreader/darkreader) (MIT, ver `vendor/darkreader-LICENSE.txt`), usada para o tema escuro da página inteira
- `icons/` — ícones da extensão (16/32/48/128px), recortados de `suri-cbm-logo-blue.png` (o wordmark "suri", sem a tagline "by Chatbot Maker")

## Como carregar localmente

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o modo "Desenvolvedor".
3. Clique em "Carregar sem compactação".
4. Selecione a pasta da extensão: `c:\Users\SURI - BEM 159\OneDrive\My Home\Lucas\Extensão Suri`.
5. A extensão ficará disponível no navegador.

## Observações importantes

- Este projeto usa leitura do DOM já renderizado na página autenticada do usuário e interceptação de rede no mesmo contexto do site.
- O dado principal da sessão vem do campo `dateAnswer` retornado pela API de conversas (endpoint `.../conversations/...`), não do campo "INÍCIO" mostrado no painel lateral — esse é o horário confiável de início do atendimento, em UTC (o `new Date(...)` do JavaScript já converte automaticamente para o horário local, então nenhum ajuste manual de fuso é necessário).
- A API retorna a fila inteira de conversas em atendimento numa lista (`ata: [...]`, cada item com `userPhone`, `userName`, `dateAnswer`). O `network-interceptor.js` já captura todos os itens dessa lista, não só a conversa aberta no momento.
- Cada cliente na lista à esquerda é uma linha `<tr class="messaginguseritemgrid">`, com o nome (ou telefone, quando não há nome salvo) em `.messaginglist-name`. `content-script.js` casa esse texto com os dados capturados da rede (por telefone ou por nome) e pinta uma barrinha colorida na borda esquerda da célula do avatar dessa linha, conforme a regra de tempo ativa.
- Nem todo contato tem telefone (visitantes de WebChat, por exemplo) — nesse caso a extensão guarda/casa a conversa pelo `conversationId` interno da plataforma ou pelo nome, em vez de exigir um telefone.
- Atualizações da fila em tempo real (um cliente entrando em "Atendimentos") costumam chegar via WebSocket, ou via XHR com `responseType: "json"`, não só por uma chamada `fetch`/XHR de texto simples — por isso `network-interceptor.js` intercepta os três formatos.
- O tema escuro usa o [Dark Reader](https://github.com/darkreader/darkreader) de verdade (`DarkReader.enable({ brightness, contrast }, { ignoreInlineStyle: [...] })`), não um filtro CSS caseiro — ele analisa as cores reais da página e se mantém sincronizado sozinho com a SPA, então não precisa ser reaplicado manualmente ao trocar de conversa.
- Chamamos `DarkReader.setFetchMethod(window.fetch)` antes do primeiro `enable()` — sem isso, o Dark Reader não consegue ler as regras de qualquer stylesheet carregado com `crossorigin` (comum em builds com hash tipo Vite, ex. `index-XXXX.css`), porque o navegador bloqueia acesso via JS a `.cssRules` nesses casos. É a própria correção documentada no código-fonte da biblioteca para esse cenário.
- Componentes específicos (ex. cards do Material-UI, `.MuiCard-root`) às vezes têm cor definida via `<style data-emotion>` gerado em tempo de execução que o Dark Reader não reprocessa — para esses casos há um CSS de reforço em `content-script.js` (`.suri-dark-mode-fallback`), aplicado só como camada de baixo, sem sobrescrever o que o Dark Reader já acerta sozinho.
- A extensão roda em `https://portal.chatbotmaker.io/*`, `https://portal.suri.ai/*` e `https://app.talkjs.com/*` (`host_permissions`/`matches` em `manifest.json`). Se a Suri passar a usar outro domínio, adicione-o nesses dois lugares.
- A área de mensagens da conversa e o painel de Detalhes ficam dentro de um `<iframe>` de terceiros (`app.talkjs.com`, o widget [TalkJS](https://talkjs.com/)) — sem esse domínio nos `matches` (com `all_frames: true`), o Dark Reader e o resto da extensão não alcançam esse conteúdo, mesmo estando visualmente "dentro" do Suri.
- O TalkJS não tem um toggle próprio nas configurações: como ele roda dentro de um iframe, `content-script.js` usa `location.ancestorOrigins` para descobrir qual domínio (Chatbot Maker ou Suri) está de fato o incorporando, e segue o liga/desliga e o tema desse domínio pai automaticamente.
- Se a Suri mudar o layout, revise os seletores em `selectors.js` e os passos de inspeção do DevTools.

## Manutenção

Se o painel de detalhes não encontrar o telefone da conversa, siga este processo:

1. Abra a conversa e pressione F12.
2. Vá em Elements e localize o painel de Detalhes.
3. Procure o campo "TELEFONE" e o bloco pai correspondente.
4. Ajuste `LABEL_ALIASES` e a lógica em `findPhoneField()` em `selectors.js`.
5. Recarregue a extensão e teste a conversação ativa.

## Melhorias futuras

- Notificação sonora ou visual ao ultrapassar um limite configurado.
- Histórico dos tempos de atendimento por conversa.
- Exportação dos dados para CSV.
- Modo de apoio com status em tempo real e relatórios do dia.
