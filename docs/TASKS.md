# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-028  Mark the two 203 dpi cable-flag sizes as confirmed on paper
Why:     as duas foram impressas numa B1 em 2026-09-10 e saíram certas, então o
         `_note` e o changelog, que dizem "not confirmed on paper", passaram a ser
         doc falso.
Vikunja: 1533
Files:   registry.json, CHANGELOG.md
Do:      nas entradas `T30x45_b1` e `T25x38_b1` de `sizes`, troque no `_note` a
         frase que diz que a geometria é derivada e NÃO foi confirmada no papel por
         uma que diga, nesta ordem:
           - a geometria é derivada da escala de 8,0 px/mm da B1 (`T50x30_b1`),
           - e foi **CONFIRMED on paper 2026-09-10** (use exatamente esta sequência
             de palavras, o Verify a procura): impressa numa B1, sem corte lateral e
             com o registro correto no sentido do papel,
           - por isso a entrada não carrega `offset_y_px`: nada a corrigir, e não
             porque falte medir.
         Não altere nenhum outro campo dessas entradas, e não toque nas irmãs de
         300 dpi.
         Em `CHANGELOG.md`, sob `## [Unreleased]`, corrija a mesma afirmação no item
         do T-027: hoje ele diz que a geometria não foi confirmada e que ninguém
         imprimiu, o que virou falso. Diga que foi confirmada numa B1 em 2026-09-10.
         Não crie item novo para o T-028: a correção pertence ao item que já existe.
         Não bump de versão.
Verify:  python -c "import json,io; d=json.load(io.open('registry.json',encoding='utf-8')); s=d['sizes']; import sys; [sys.exit('missing confirmation in '+k) for k in ('T30x45_b1','T25x38_b1') if 'CONFIRMED on paper 2026-09-10' not in s[k]['_note']]; [sys.exit('stale claim in '+k) for k in ('T30x45_b1','T25x38_b1') if 'NOT been confirmed' in s[k]['_note']]; [sys.exit('offset appeared in '+k) for k in ('T30x45_b1','T25x38_b1') if 'offset_y_px' in s[k]]; print('ok')"
         python -c "import io; s=io.open('CHANGELOG.md',encoding='utf-8').read(); i=s.index('## [Unreleased]'); j=s.index('## [', i+5); body=s[i:j]; assert 'not confirmed on paper' not in body.lower(), 'changelog still claims it is unconfirmed'; assert '2026-09-10' in body; print('ok')"
         node --check src/niimbot.js

## [ ] T-029  Report the battery level, per model
Why:     o `getStatus()` já devolve o byte, mas ninguém sabe lê-lo: a mesma posição é
         percentual em umas impressoras e enum 0-4 em outras, e isso só foi esclarecido
         em 2026-09-10 (niimbluelib#28).
Vikunja: 1534
Files:   src/niimbot.js, demo/index.html, test/battery.test.js, CLAUDE.md, CHANGELOG.md
After:   T-028
Do:      1. Em `MODEL_IDS` (`src/niimbot.js`, grep o nome — a linha se move), acrescente
            um campo `batteryScale` a CADA modelo já listado:
              - 4097 (B1 Pro): "percent"
              - 6912 (B2 Pro): "percent"
              - todos os demais: "enum"
            Um comentário curto acima da tabela, ou no bloco de cada um, tem de separar
            as duas origens, porque elas NÃO têm a mesma força:
              - B1 Pro é MEDIDO aqui: o byte leu 0x50 (80) em seis capturas e 0x28 (40)
                noutra, e na mesma conexão o `0x40[0x0a]` devolveu o mesmo 0x28.
              - B2 Pro vem da afirmação do upstream em niimbluelib#28, NÃO foi medido
                aqui.
              - "enum" é o padrão que o upstream descreve (0=0%, 1=25%, 2=50%, 3=75%,
                4=100%); para os modelos desta casa ele não foi verificado um a um.
         2. Acrescente um reporter PURO, exportado ao lado de `getStatus`:
              Niimbot.battery(status) -> { raw, scale, percent, text, evidence } | null
            Regras, e elas são o coração da tarefa:
              - `raw` é o byte cru (`status.decoded.heartbeat.chargeLevel`). Se não
                houver heartbeat decodificado ou o campo for undefined, devolva null.
              - escala "percent": `percent` = raw, e se raw > 100 devolva
                scale "unknown" e `percent` null.
              - escala "enum": raw 0..4 -> percent = raw * 25. **raw > 4 é
                CONTRADIÇÃO**: devolva scale "unknown" e `percent` null. Não converta,
                não adivinhe.
              - `text` é legível: "40%" no percentual, "100% (level 4 of 4)" no enum,
                e algo como "unknown (raw 40 on a 0-4 scale)" na contradição.
              - `evidence` repassa o que `getStatus` já marcou para esse campo
                (`status.decoded.evidence.heartbeat.chargeLevel`), sem inventar nível
                novo.
            A função é pura: não chama nada, não conecta, não altera estado — igual à
            `readiness()`, e pelo mesmo motivo.
         3. Na demo (`demo/index.html`), mostre o resultado no painel *Read status*,
            numa linha só, com o texto do reporter. Quando a evidência não for
            `observed`, a linha tem de dizer que é inferido. Se `battery()` devolver
            null, não mostre linha nenhuma em vez de mostrar zero.
         4. Escreva `test/battery.test.js` no molde dos outros harnesses de `test/`
            (stub dos globais do browser antes de carregar o arquivo — ver o aviso do
            `CLAUDE.md` sobre `navigator`). Casos obrigatórios:
              - percent 40 -> 40%
              - enum 4 -> 100%, enum 0 -> 0%
              - enum com raw 40 -> scale "unknown", percent null
              - percent com raw 200 -> scale "unknown", percent null
              - status sem heartbeat -> null
         5. Acrescente `node test/battery.test.js` à lista de Verify do `CLAUDE.md`.
            É consequência factual da sua própria mudança, então pode.
         6. Registre em `CHANGELOG.md` sob `## [Unreleased]`. Não bump de versão.
         NÃO ligue a bateria a nenhum caminho de impressão: como o resto do
         `getStatus`, isto REPORTA e não decide nada.
Verify:  node --check src/niimbot.js
         node test/battery.test.js
         node test/status.test.js
         node test/pacing.test.js
         extrair os <script> sem src de demo/index.html e rodar node --check em cada
         um (o bloco python está no CLAUDE.md); é gate de sintaxe, não prova que a
         demo funciona.
