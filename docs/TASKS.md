# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-031  Record that the T12x22 offset was confirmed on paper
Why:     o `_note` da `T12x22` conta a medição feita COM offset 0 e a conta que gerou
         o −6; o −6 já aplicado foi impresso numa D11_H em 2026-09-10 e saiu
         registrado certo, o que é uma afirmação mais forte e ainda não está escrita.
Vikunja: 1536
Files:   registry.json, CHANGELOG.md
Do:      1. No `_note` da entrada `T12x22`, mantenha tudo o que já está lá e
            acrescente ao final uma frase dizendo que o offset corrigido foi impresso
            numa D11_H em 2026-09-10 e saiu com o registro certo, usando exatamente
            a sequência **`offset CONFIRMED on paper 2026-09-10`** (o Verify a
            procura). Deixe claro que a diferença importa: antes o −6 era a correção
            DERIVADA de uma impressão com offset 0, agora ele foi impresso e visto.
            Não altere nenhum campo numérico da entrada.
         2. Em `CHANGELOG.md`, no item **Hardware confirmation, 2026-09-10** que já
            existe sob `## [Unreleased]`, acrescente que a `T12x22` foi impressa na
            D11_H com o `offset_y_px` −6 aplicado e saiu registrada corretamente.
            Não crie item novo. Não bump de versão.
Verify:  python -c "import json,io,sys; d=json.load(io.open('registry.json',encoding='utf-8')); n=d['sizes']['T12x22']['_note']; sys.exit('missing confirmation') if 'offset CONFIRMED on paper 2026-09-10' not in n else None; sys.exit('numbers changed') if d['sizes']['T12x22']['offset_y_px']!=-6 or d['sizes']['T12x22']['w_px']!=142 or d['sizes']['T12x22']['h_px']!=260 else None; print('ok')"
         python -c "import io,sys; s=io.open('CHANGELOG.md',encoding='utf-8').read(); i=s.index('Hardware confirmation, 2026-09-10'); j=s.index('- **T-030', i); sys.exit('T12x22 not mentioned') if 'T12x22' not in s[i:j] else None; print('ok')"
         node --check src/niimbot.js
