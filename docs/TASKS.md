# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-038  Catch a truncated upload with the 0xD3 row-received counter
Why:     a falha característica deste driver é a etiqueta curta ou em branco com o
         progresso em 100% — quebrou a v1.3.3 e a v1.3.4, e reapareceu em 2026-09-10 numa
         D11_H: uma página de 208 frames em `paced` sai cortada, e a MESMA página em
         `acked` sai inteira. Escrita BLE não confirmada se perde em silêncio. Só que a
         impressora manda de volta, sem ninguém pedir, um `0xD3` com a última linha que
         ela recebeu (`docs/NOTES.md`, *`0xD3` is a row-received counter* e *Ink is free,
         row changes are not*). O driver hoje arquiva esse valor em `lastUnsolicited` e
         joga fora. Comparar o que voltou com o que foi mandado transforma a falha
         silenciosa em erro na hora, com o número da linha.
Files:   src/niimbot.js, test/rows-received.test.js (novo), CHANGELOG.md, CLAUDE.md
Do:      1. Rastreie, durante o upload de UMA página, o MAIOR valor de `0xD3` visto.
            O payload tem 3 bytes: os dois primeiros são o índice da última linha
            recebida, big-endian (`00 c7` = 199, `01 03` = 259 — confirmado nas duas
            frames de uma página toda preta). Zere o rastreador no início de cada página,
            não do job.
         2. Depois que o `PageEnd` for confirmado (`0xE4`), e SÓ nesse caso, compare:
            se algum `0xD3` foi visto E o maior deles for MENOR que `h - 1`, a página
            perdeu linhas. Trate exatamente como o caminho de página não confirmada que
            já existe (grep `unconfirmed` em `src/niimbot.js`): mande `PrintEnd` primeiro,
            depois lance. A mensagem tem de nomear os dois números — a última linha
            recebida e a esperada — e dizer que o papel pode ter saído curto.
         3. 🛑 Se NENHUM `0xD3` foi visto na página, NÃO faça nada e NÃO falhe. Só a
            D11_H e a B1 Pro foram vistas emitindo isso; um modelo silencioso não pode
            passar a quebrar. Essa é a regra de "distinguir FALHOU de NÃO CONSEGUI
            VERIFICAR" do workspace — registre a distinção com um log diferente para
            cada caso (`rows confirmed: 259/259` × `no 0xD3 seen; upload not verified`).
         4. Em `PAGE_PIPELINE = true` o rastreamento continua por página: o `0xD3` de uma
            página pode chegar enquanto a seguinte já está sendo enviada. Se você não
            conseguir atribuir o `0xD3` à página certa com confiança, então NÃO faça a
            checagem quando `PAGE_PIPELINE` estiver ligado — e diga isso no comentário e
            no relatório. Um alarme atribuído à página errada é pior que alarme nenhum.
Verify:  `node --check src/niimbot.js` mais o harness novo, sem impressora e sem
         navegador (stub de `navigator` ANTES do load — copie o padrão do topo de
         `test/unconfirmed.test.js`, inclusive o `Object.defineProperty`):
           node test/rows-received.test.js
         Casos obrigatórios, todos empurrando notificações sintéticas pelo mesmo caminho
         que o dispatcher usa:
           a) `0xD3` = `01 03` (259) numa página de 260 linhas → resolve normalmente
           b) `0xD3` = `00 c7` (199) numa página de 260 linhas → REJEITA, e a mensagem
              contém "199" e "259"
           c) vários `0xD3` (199 depois 259) → resolve; vale o MAIOR, não o último
           d) nenhum `0xD3` → resolve, sem lançar (o caso "não consegui verificar")
           e) no caso (b), `PrintEnd` (0xF3) foi enviado ANTES de lançar
         Sem regressão: node test/unconfirmed.test.js && node test/dispatch.test.js
         && node test/one-page-per-job.test.js && node test/pacing.test.js
         && node test/bundle.test.js
         Acrescente a linha do novo harness na lista de Verify do `CLAUDE.md`.
         NÃO afirme que isso conserta impressão: nada aqui vai ao papel.
