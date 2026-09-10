# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-026  Ship the D11 12x22 mm label size
Why:     medido no papel hoje (10/09/2026) na D11_H; hoje só existe pelo painel Rolls,
         que grava no navegador de quem digitou e não viaja para ninguém.
Vikunja: 1531
Files:   registry.json
Do:      acrescente uma entrada `T12x22` em `sizes`, ao lado de `T15x30` (a outra
         medida da D11_H), com exatamente estes valores:
           code:        "T12*22"
           label:       "12 × 22 mm (D11_H)"
           dpi:         300
           w_mm:        12
           h_mm:        22
           w_px:        142
           h_px:        260
           margin:      6
           offset_y_px: -6
         E um `_note` dizendo, sem inventar nada além disto:
           - 12 × 22 mm a 300 dpi. A referência de escala é a própria `T15x30`
             (30 mm → 354 px = 11,8 px/mm), então 22 mm → 260 px e 12 mm → 142 px.
           - w_px 142 é a etiqueta, não a cabeça: a cabeça da D11_H tem 144 px
             (ver o `_note` da `T15x30`), e 142 cabe dentro dela.
           - offset_y_px −6 é MEDIDO, não calculado de tabela: impresso em
             2026-09-10 com offset 0, a arte começou depois do início da etiqueta e
             terminou no limite de baixo; o dono pediu 0,5 mm antes, e
             0,5 mm × 11,8 px/mm = 5,9 → 6 px para cima (negativo sobe, conforme o
             README, seção API, `offsetY`).
         Não mexa em nenhuma outra entrada e não bump de versão.
         Registre a mudança em `CHANGELOG.md` sob `## [Unreleased]`, no mesmo commit.
Verify:  python -c "import json,io; d=json.load(io.open('registry.json',encoding='utf-8')); s=d['sizes']['T12x22']; assert (s['code'],s['dpi'],s['w_px'],s['h_px'],s['offset_y_px'])==('T12*22',300,142,260,-6), s; print('ok')"
         node --check src/niimbot.js

## [ ] T-027  Ship the two cable-flag sizes at 203 dpi
Why:     prometido em público na thread do r/selfhosted hoje: num B1 (203 dpi) o
         seletor só oferece uma medida, porque as duas cable flag que existem são
         300 dpi e `demo/index.html:343` filtra por dpi exato.
Vikunja: 1532
Files:   registry.json
Do:      acrescente duas entradas em `sizes`, irmãs das 300 dpi já existentes
         (`T30x45` e `T25x38`), sem tocar nas originais:
           T30x45_b1 → code "T30*45+50", label "30 × 45 mm (cable flag, 203 dpi)",
                       dpi 203, w_mm 30, h_mm 45, w_px 240, h_px 360, margin 10
           T25x38_b1 → code "T25*38+40", label "25 × 38 mm (cable flag, 203 dpi)",
                       dpi 203, w_mm 25, h_mm 38, w_px 200, h_px 304, margin 10
         A escala 8,0 px/mm vem da `T50x30_b1`, que tem 30 mm → 240 px. Ambas as
         larguras ficam abaixo dos 384 px da cabeça do B1, então não há clipe a
         considerar.
         **Sem `offset_y_px`.** Nenhuma das duas foi impressa: o campo só entra
         quando alguém medir, como aconteceu na `T15x50` e na `T12x22`.
         O `_note` de cada uma tem de dizer, com estas palavras ou equivalentes,
         que a geometria é DERIVADA da escala do B1 e **não foi confirmada no
         papel**, e que o `code` é o mesmo da irmã de 300 dpi.
         Registre a mudança em `CHANGELOG.md` sob `## [Unreleased]`, no mesmo commit.
Verify:  python -c "import json,io; d=json.load(io.open('registry.json',encoding='utf-8')); s=d['sizes']; a=s['T30x45_b1']; b=s['T25x38_b1']; assert (a['dpi'],a['w_px'],a['h_px'])==(203,240,360), a; assert (b['dpi'],b['w_px'],b['h_px'])==(203,200,304), b; assert 'offset_y_px' not in a and 'offset_y_px' not in b; assert s['T30x45']['dpi']==300 and s['T25x38']['dpi']==300; print('ok')"
         node --check src/niimbot.js
