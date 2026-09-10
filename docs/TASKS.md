# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-030  Show lid, paper and battery right after identify
Why:     o `identify` já lê o status para restaurar a etiqueta lembrada, e joga fora
         tampa, papel e bateria — que é justamente o que a pessoa quer ver ao conectar.
Vikunja: 1535
Files:   demo/index.html, CHANGELOG.md
Do:      1. Extraia do handler do botão `readstatus` a montagem da frase de status
            (tampa, papel, bateria, com as marcas de evidência por campo e o
            `(inferred)` da bateria) para uma função pura, tipo
            `statusSummary(st) -> string | null`, declarada uma vez e usada pelos
            DOIS lugares. Não duplique o texto: duas cópias divergem no primeiro
            ajuste.
            Ela devolve null quando o heartbeat não foi reconhecido, e o chamador
            decide o que fazer.
         2. No handler do `identify`, o bloco que hoje faz
            `reviewTag(await Niimbot.getStatus(), true)` passa a guardar o resultado
            numa variável, entregar a MESMA variável ao `reviewTag`, e acrescentar o
            `statusSummary()` à mensagem de identificação já mostrada.
            **Proibido chamar `getStatus()` uma segunda vez**: é uma ida ao hardware
            com timeout, e a tarefa existe para reaproveitar a que já existe.
         3. Preserve o isolamento de falha que já está lá: se a leitura de status
            falhar, a identificação continua valendo e a mensagem dela não some. O
            `catch` atual só loga; mantenha esse comportamento.
         4. Registre em `CHANGELOG.md` sob `## [Unreleased]`. Não bump de versão.
Verify:  extrair os <script> sem src de demo/index.html e rodar node --check em cada
         um (bloco python no CLAUDE.md)
         node --check src/niimbot.js
         node test/draw-fit.test.js
         node test/battery.test.js
         grep -c "getStatus()" demo/index.html  → o total NÃO pode aumentar em
         relação ao valor antes da sua mudança (anote os dois números no relatório)
         ⚠ Este Verify é gate de sintaxe e de não-regressão de chamadas, e NÃO prova
         que a frase aparece na tela. A conferência visual é do mantenedor, com
         impressora ligada, e o relatório tem de dizer isso.
