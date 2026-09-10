# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-036  Pipeline the next page while the previous ack is in flight
Why:     na D11_H o ack do PageEnd custa 2,0 a 2,7 s e o driver só manda a página
         seguinte depois dele, então a impressora imprime, seca e para — medido em
         2026-09-10, sem retração. O app oficial imprime 4 etiquetas DIFERENTES
         emendadas, e o `copies:4` do próprio driver também sai contínuo, o que mostra
         que o hardware não é o limite.
After:   T-035
Files:   src/niimbot.js, CHANGELOG.md, docs/NOTES.md
Vikunja: 1542
Do:      1. Acrescente `PAGE_PIPELINE`, booleano, **default `false`**, exposto com
            getter/setter como `PAGE_ACK_MS`. O comentário diz o que ele é: um
            DIAGNÓSTICO sob medição, não uma configuração, e por que está desligado —
            ninguém confirmou no papel que a impressora aceita a página seguinte com o
            ack da anterior pendente.
         2. No caminho de streaming do `printBatch` (o laço de N páginas de um job só),
            quando `PAGE_PIPELINE` estiver ligado: envie a página `i+1` sem esperar o
            `0xE4` da página `i`; guarde a promessa do ack e **cobre todas antes do
            `PrintEnd`**. A garantia que não pode cair: se QUALQUER página ficou sem
            ack, o job termina como não confirmado, com a mesma mensagem e a mesma
            ordem de hoje (PrintEnd primeiro, throw depois).
            Com o flag desligado, o caminho tem de ser byte a byte o de hoje.
         3. Registre no log, por página, o tempo do ack como já se faz, e ao final uma
            linha com o total do job, para a comparação ficar no próprio log.
         4. `docs/NOTES.md`: registre a medição que motivou a tarefa (a impressora para
            sem retrair; `copies:4` sai contínuo; o app oficial emenda 4 etiquetas
            distintas) e deixe explícito que o efeito do pipeline **ainda não foi
            medido** — a tarefa entrega o interruptor, não o resultado.
         5. `CHANGELOG.md` sob `## [Unreleased]`. Sem bump de versão.
Verify:  node --check src/niimbot.js
         node test/dispatch.test.js
         node test/unconfirmed.test.js
         node test/one-page-per-job.test.js
         node test/pacing.test.js
         python -c "import io,sys; s=io.open('src/niimbot.js',encoding='utf-8').read(); sys.exit('flag missing') if 'PAGE_PIPELINE' not in s else None; sys.exit('flag must default to false') if 'PAGE_PIPELINE = false' not in s else None; print('ok')"
