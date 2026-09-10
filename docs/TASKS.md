# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

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
