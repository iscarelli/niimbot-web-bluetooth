# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-032  The B1 and the D11_H enum scale is measured now, not assumed
Why:     em 2026-09-10 as três impressoras foram conferidas contra o app oficial:
         B1 Pro 40% (byte 40, percentual), B1 nível 4 e app 100%, D11_H nível 3 e app
         75%. Nos dois últimos o `batteryScale: "enum"` deixou de ser o padrão do
         upstream e passou a ser medido, e o comentário no código ainda diz o
         contrário.
Files:   src/niimbot.js, CHANGELOG.md
Vikunja: 1537
Do:      1. Em `MODEL_IDS` (`src/niimbot.js`), troque o comentário do modelo
            **4096 (B1)** e do modelo **528 (D11_H)**: hoje ambos dizem que "enum" é
            o padrão do upstream e não foi verificado nesse modelo. Passe a dizer que
            foi MEDIDO em 2026-09-10 contra o app oficial da NIIMBOT, com o valor de
            cada um:
              - B1: o byte veio 4 e o app mostrou 100 %. Se a escala fosse percentual
                o app teria mostrado 4 %, então o enum é o que explica a leitura.
              - D11_H: o byte veio 3 e o app mostrou 75 %, que é o caso NÃO trivial —
                não é bateria cheia, então não é coincidência de ponta de escala.
            Não mexa nos outros modelos: neles "enum" continua sendo o padrão do
            upstream, e escrever o contrário seria doc falso.
         2. Se houver comentário geral sobre `batteryScale` acima da tabela dizendo
            que só o B1 Pro tem medição própria, corrija-o pelo mesmo motivo.
         3. Em `CHANGELOG.md`, sob `## [Unreleased]`, o item **Hardware confirmation,
            2026-09-10** diz hoje que a confirmação **não** confirma a escala "enum".
            Isso virou falso para B1 e D11_H. Corrija a frase para dizer em quais
            modelos a escala passou a ser medida e em quais continua sendo o padrão
            do upstream. Não crie item novo, e não bump de versão.
Verify:  node --check src/niimbot.js
         node test/battery.test.js
         python -c "import io,sys; s=io.open('src/niimbot.js',encoding='utf-8').read(); i=s.index('4096:'); j=s.index('4097:'); sys.exit('B1 comment not updated') if 'not verified on this model' in s[i:j] else None; k=s.index('528:'); l=s.index('\n', k); sys.exit('D11_H comment not updated') if 'not verified on this model' in s[k:l] else None; print('ok')"
         python -c "import io,sys; s=io.open('CHANGELOG.md',encoding='utf-8').read(); i=s.index('Hardware confirmation, 2026-09-10'); j=s.index('- **T-030', i); b=s[i:j]; sys.exit('changelog still denies the enum measurement') if 'does not' in b and 'enum' in b.split('does not')[1][:200] else None; print('ok')"
