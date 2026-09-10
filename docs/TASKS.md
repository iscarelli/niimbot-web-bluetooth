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
