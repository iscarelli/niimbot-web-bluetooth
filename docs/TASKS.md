# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-039  Bundle frames by default on the D11_H
Why:     medido em papel na madrugada de 2026-09-11, numa D11_H real. Sem bundling o
         modelo manda UMA escrita BLE não confirmada por frame de linha; um lote real de
         10 páginas (99 a 208 frames cada, `test/fixtures/qdc-etiquetas/`) saía com ZERO
         etiquetas, e uma página sozinha de 208 frames saía cortada no fim — perda
         silenciosa de escrita, a falha que quebrou a v1.3.3 e a v1.3.4. Com
         `Niimbot.BUNDLE = true` (T-037) e nada mais mudado, o MESMO lote saiu inteiro
         DUAS vezes, contínuo como o app oficial, em 10,5 s, com `rows confirmed: 259/259`
         nas dez. As 208 escritas viram ~21, e o upload de uma página cai de ~2080 ms para
         ~334 ms — abaixo dos ~900 ms que a impressão leva, que é o que elimina a pausa
         entre etiquetas. Confirmado ainda no pior caso possível: 3 páginas de 260 linhas
         TODAS distintas (260 frames, o teto para essa altura) passaram, com a mesma
         confirmação de linhas.
Files:   src/niimbot.js, CHANGELOG.md
Do:      1. Em `MODEL_IDS` (grep o nome, a linha anda), na entrada `528` do
            `Niimbot D11_H`, troque `bundle: false` por `bundle: true`.
         2. Substitua/estenda o comentário dessa linha para dizer que é MEASURED em papel
            2026-09-11, no formato que as outras entradas MEASURED já usam — e que sem
            bundling o mesmo lote de 10 páginas não saía. Não invente número: use os desta
            tarefa (10 páginas, duas vezes, 10,5 s, ~334 ms de upload contra ~2080 ms).
         3. NÃO mexa em nenhum outro modelo. B1 e M2-H já são `true`; todo o resto fica
            `false` — nenhum deles foi medido e presumir família é exatamente o erro que
            quebrou a B1 Pro na v1.3.3 (veja *Per-model, not per-task* no CLAUDE.md).
         4. NÃO mexa em `docs/NOTES.md` — o planner está escrevendo essa parte.
Verify:  `node --check src/niimbot.js` mais:
           node test/bundle.test.js
         Esse harness usa modelos com `bundle:false` e `bundle:true` nos casos (a), (b) e
         (c). Se algum caso dependia da 528 ser `false`, ele vai quebrar: conserte o
         HARNESS escolhendo outro modelo que ainda seja `false`, não a mudança. Se ele
         passar sem tocar em nada, diga isso no relatório.
         Sem regressão: node test/rows-received.test.js && node test/pacing.test.js
         && node test/dispatch.test.js && node test/unconfirmed.test.js
         && node test/one-page-per-job.test.js && node test/status.test.js
