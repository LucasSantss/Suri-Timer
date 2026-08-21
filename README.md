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
- A API retorna a fila inteira de conversas numa lista (cada item com `userPhone`, `userName`, `dateAnswer`, `dateRequest`, `lastSenderChange`). O `network-interceptor.js` captura todos os itens dessa lista, de qualquer uma das filas (Atendimentos, Automático, Esperando), não só a conversa aberta no momento.
- A fila de cada conversa vem do próprio campo `type` de cada item retornado pela API (`0` = Automático, `1` = Esperando, `2` = Atendimentos), lido em `network-interceptor.js` (`QUEUE_TYPE_MAP`) — é a única fonte usada para classificar a fila. Não há inferência por `dateAnswer`/`dateRequest`/`agentId`: essa heurística chegou a existir mas foi removida porque `agentId` é preenchido assim que um agente assume a conversa, antes da primeira resposta, o que classificava incorretamente conversas ainda em Esperando como Atendimentos. Uma conversa sem `type` utilizável fica sem cor.
- Cada cliente na lista à esquerda é uma linha `<tr class="messaginguseritemgrid">`, com o nome (ou telefone, quando não há nome salvo) em `.messaginglist-name`. `content-script.js` casa esse texto com os dados capturados da rede (por telefone ou por nome) e pinta uma barrinha colorida na borda esquerda da célula do avatar dessa linha, conforme a regra ativa para a fila daquela conversa: Atendimentos usa as faixas de tempo configuráveis (tela "Tempos") a partir de `dateAnswer`; Automático usa uma régua fixa a partir de `lastSenderChange` (verde/vermelho) cuja janela depende do canal, inferido pelo prefixo de `conversationId`: WebChat (`wc`) nunca fica vermelho, Facebook/Instagram (`fb`/`ig`) usam 7 dias, os demais (WhatsApp, `wp`) usam 24h; Esperando nunca recebe marcador.
- Nem todo contato tem telefone (visitantes de WebChat, por exemplo) — nesse caso a extensão guarda/casa a conversa pelo `conversationId` interno da plataforma ou pelo nome, em vez de exigir um telefone.
- Atualizações da fila em tempo real (um cliente entrando em "Atendimentos") costumam chegar via WebSocket, ou via XHR com `responseType: "json"`, não só por uma chamada `fetch`/XHR de texto simples — por isso `network-interceptor.js` intercepta os três formatos.
- O tema escuro usa o [Dark Reader](https://github.com/darkreader/darkreader) de verdade (`DarkReader.enable({ brightness, contrast }, { ignoreInlineStyle: [...] })`), não um filtro CSS caseiro — ele analisa as cores reais da página e se mantém sincronizado sozinho com a SPA, então não precisa ser reaplicado manualmente ao trocar de conversa.
- Chamamos `DarkReader.setFetchMethod(window.fetch)` antes do primeiro `enable()` — sem isso, o Dark Reader não consegue ler as regras de qualquer stylesheet carregado com `crossorigin` (comum em builds com hash tipo Vite, ex. `index-XXXX.css`), porque o navegador bloqueia acesso via JS a `.cssRules` nesses casos. É a própria correção documentada no código-fonte da biblioteca para esse cenário.
- Componentes específicos às vezes têm cor definida de um jeito que o Dark Reader não reprocessa (ex. cards do Material-UI `.MuiCard-root`, cujo `<style data-emotion>` é gerado em tempo de execução; ou os cartões do editor de Fluxos, `.flow-node`) — para esses casos há uma lista de CSS de reforço em `content-script.js` (`.suri-dark-mode-fallback`), aplicada só como camada de baixo, sem sobrescrever o que o Dark Reader já acerta sozinho. É o mesmo princípio que a própria extensão oficial usa (força um fundo escuro em `html`/`body` incondicionalmente e depois tem uma lista de correções por seletor para casos específicos) — se aparecer outro elemento branco em alguma tela, é só adicionar o seletor dele nessa mesma lista.
- A extensão roda em `https://portal.chatbotmaker.io/*`, `https://portal.suri.ai/*`, `https://app.talkjs.com/*`, `https://app.chatbotmaker.io/*` e `https://flow.chatbotmaker.io/*` (`host_permissions`/`matches` em `manifest.json`, sempre nos três lugares — os dois `content_scripts` e o `host_permissions`). Se a Suri passar a usar outro domínio, adicione-o nesses três arrays.
- Várias seções da Suri são, na verdade, iframes de outros subdomínios — cada um só funciona depois de ser adicionado nos `matches`. Confirmados até agora: `app.talkjs.com` (chat/TalkJS), `app.chatbotmaker.io` (`id="portalV2Iframe"`, usado pelo "Chat Interno") e `flow.chatbotmaker.io` (editor de Fluxos). Sem o domínio do iframe nos `matches` (com `all_frames: true`), nada da extensão roda ali dentro, mesmo estando visualmente "dentro" do Suri — se aparecer outra tela sem tema escuro, o primeiro passo é sempre checar (Inspecionar → subir a árvore) se ela também é um iframe de um domínio novo.
- Nenhum desses iframes tem um toggle próprio nas configurações: `content-script.js` usa `location.ancestorOrigins` (percorrendo os frames pais até achar um domínio conhecido) para descobrir qual portal está de fato os incorporando, e segue o liga/desliga e o tema desse domínio pai automaticamente.
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
