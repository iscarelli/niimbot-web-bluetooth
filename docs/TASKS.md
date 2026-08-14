# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-012  A demo manda o iPhone para um navegador que não existe
Why:     divulgar o projeto joga estranhos direto na demo, e hoje o iOS lê
         "use Chrome/Edge" — conselho falso lá, porque nenhum navegador de
         iOS tem Web Bluetooth, nem o Chrome do iOS. A saída real (Bluefy)
         está só no README, que essa pessoa não vai abrir.
Vikunja: 992
Files:   demo/index.html
Do:      Trocar as duas frases que hoje falam só em Chrome/Edge — o aviso de
         topo (`demo/index.html:78`) e a mensagem de indisponibilidade
         (`demo/index.html:286`) — por um caminho por plataforma:
         desktop = Chrome/Edge; Android = Chrome; iOS = **Bluefy**
         (https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055),
         porque no iOS o Safari e o Chrome não expõem Web Bluetooth.
         Só texto/markup: **não** mexer na detecção nem em nenhum caminho de
         impressão. Manter a menção a HTTPS/localhost que já existe.
Verify:  1. syntax gate dos blocos <script> inline (o comando python+node
            --check do CLAUDE.md) tem de sair 0;
         2. `node demo/serve.mjs`, abrir a página no **Chrome** → o aviso de
            topo cita as três plataformas;
         3. abrir a MESMA url no **Firefox**, que não tem Web Bluetooth → a
            mensagem de indisponibilidade aparece e cita o Bluefy para iOS.
            (Se o Firefox não estiver instalado, diga isso no relatório em vez
            de dar o passo por verificado.)
