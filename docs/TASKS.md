# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-033  Expose the PageEnd timeout and log how long each ack took
Why:     o prazo de 3000 ms para a PageEnd está cravado no código, veio do commit
         inicial do driver e nunca foi medido; ele é o suspeito da falha relatada pela
         sessão do ESP32-Telemetria-Suite em 2026-09-10 (lote de 10 páginas de texto
         na D11_H, cortado no meio da página 1). Hoje quem chama não pode ajustá-lo
         nem sabe quanto cada ack demorou.
Files:   src/niimbot.js, test/unconfirmed.test.js, CLAUDE.md, CHANGELOG.md
Vikunja: 1538
Do:      1. Substitua o literal `3000` da chamada `sendWait(0xe3, [0x01], 0xe4, 3000)`
            por uma variável de módulo `PAGE_ACK_MS`, inicializada em 3000, ao lado de
            `PAGE_WAIT_MS`. Exponha-a como getter/setter no objeto público, no mesmo
            molde de `PAGE_WAIT_MS` (mínimo 1).
            O comentário dela tem de dizer duas coisas verdadeiras: que 3000 é
            HERDADO do commit inicial e **nunca foi medido**, e que ela é o prazo de
            UMA página, diferente de `PAGE_WAIT_MS`, que é o do contador de páginas
            impressas do job inteiro. Confundir as duas é o erro que a existência
            desta tarefa prova ser fácil.
         2. Meça e registre o tempo do ack: em volta dessa chamada, marque o instante
            antes e depois e emita uma linha de log (o `tlog` usado no resto do
            caminho de impressão) dizendo quantos ms a PageEnd levou — tanto no
            sucesso quanto na falha, e no caso de falha citando o teto vigente.
            Ex.: `page 3: PageEnd acked in 812 ms` / `page 3: PageEnd UNACKED after
            3000 ms (PAGE_ACK_MS)`.
         3. Inclua o número no erro: a mensagem de página não confirmada
            (`page N of M was never acknowledged (no PageEnd ack)`) passa a dizer o
            teto que expirou, para o relatório de quem chama já trazer o dado.
         4. Estenda `test/unconfirmed.test.js` com um caso que prove o novo controle:
            com `PAGE_ACK_MS` baixo (ex.: 50) e um characteristic falso que nunca
            responde ao `0xE3`, a chamada tem de rejeitar **rápido** — o teste falha
            se demorar perto do valor antigo. Mantenha os casos que já existem.
         5. Se o `CLAUDE.md` listar os harnesses, ele já cita este arquivo; não
            acrescente linha nova, só confirme.
         6. Registre em `CHANGELOG.md` sob `## [Unreleased]`. Não bump de versão.
         NÃO mude o valor padrão: 3000 continua sendo o default até alguém medir. A
         tarefa é dar o controle e o número, não escolher um novo prazo no escuro.
Verify:  node --check src/niimbot.js
         node test/unconfirmed.test.js
         node test/battery.test.js
         node test/status.test.js
         python -c "import io,sys; s=io.open('src/niimbot.js',encoding='utf-8').read(); sys.exit('literal 3000 still in the PageEnd call') if '0xe4, 3000' in s else None; sys.exit('PAGE_ACK_MS not exposed') if 'PAGE_ACK_MS' not in s else None; print('ok')"
