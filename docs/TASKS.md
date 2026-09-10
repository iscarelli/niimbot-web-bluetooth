# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-034  Raise the PageEnd deadline, with the measurement behind it
Why:     medido na D11_H em 2026-09-10: dez PageEnd num lote de 10 páginas levaram
         2057, 2080, 2208, 2337, 2379, 2532, 2629, 2635, 2666 e 2684 ms, e uma
         tentativa anterior estourou os 3000 ms por ~70 ms e matou o job. O default
         herdado dá margem de coin flip, e o `e4` chega DEPOIS de a página imprimir,
         então o teto tem de ser maior que o tempo físico de uma etiqueta.
Files:   src/niimbot.js, docs/NOTES.md, docs/protocol-v4.md, CHANGELOG.md
Vikunja: 1540
Do:      1. `PAGE_ACK_MS` passa de 3000 para **10000**. O comentário dela troca "3000
            é herdado e nunca foi medido" por: 10000 é MEDIDO com folga sobre a
            distribuição observada na D11_H (2,0 a 2,7 s, com uma excursão além de
            3,0 s), e o custo de errar para cima é só demorar mais a declarar uma
            página que a impressora nunca vai confirmar.
         2. Ainda em `src/niimbot.js`, corrija o texto do log que hoje diz
            `image buffered (PageEnd acked)` / `page N: buffered (PageEnd acked)`.
            Na D11_H o `0xE4` chega **depois** de a página imprimir (o contador
            responde `print 100%` ~100 ms depois), então "buffered" afirma o que os
            dados negam. Use algo que diga apenas o que se sabe, como
            `PageEnd acked`, e deixe a explicação para o NOTES. Não invente o mesmo
            comportamento para os outros modelos: só a D11_H foi medida.
         3. `docs/NOTES.md`: seção nova com a medição — data, modelo, os dez números,
            a página de 79 frames usada, o fato de a falha ter sido reproduzida com
            3000 e sumido com 10000, e a inferência de que o ack segue a impressão
            física (com o ponteiro para as linhas do contador que sustentam isso).
            Diga também o que NÃO foi medido: os demais modelos.
         4. `docs/protocol-v4.md`: na descrição do PageEnd (`0xE3` → `0xE4`),
            acrescente que na D11_H o ack só volta depois de a página sair, com o
            intervalo medido, e que o `0xD3` aparece um instante antes do `0xE4`.
         5. `CHANGELOG.md` sob `## [Unreleased]`. Não bump de versão.
Verify:  node --check src/niimbot.js
         node test/unconfirmed.test.js
         node test/one-page-per-job.test.js
         node test/pacing.test.js
         python -c "import io,sys; s=io.open('src/niimbot.js',encoding='utf-8').read(); sys.exit('default not raised') if 'PAGE_ACK_MS = 10000' not in s else None; sys.exit('stale buffered wording') if 'buffered (PageEnd acked)' in s else None; print('ok')"
         python -c "import io,sys; n=io.open('docs/NOTES.md',encoding='utf-8').read(); sys.exit('measurement not recorded') if '2684' not in n or '2057' not in n else None; print('ok')"
