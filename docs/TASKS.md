# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active
## [ ] T-025  Tell "no Web Bluetooth" apart from "insecure context"
Why:     a mensagem atual culpa o HTTPS em todos os casos e mandou o primeiro usuário do
         lançamento (r/selfhosted, 09/09/2026) procurar no lugar errado — ele estava em
         HTTPS, e a causa real era o navegador não expor a API (Brave desliga a Web
         Bluetooth por padrão, atrás de flag). A checagem é `!!navigator.bluetooth`, que
         não sabe nada sobre o esquema da página.
Files:   src/niimbot.js, demo/index.html, CHANGELOG.md
Do:      Em `src/niimbot.js:433` (grep `Web Bluetooth unavailable`, a linha se move),
         separar as duas causas usando `window.isSecureContext`, que é exatamente o que o
         navegador exige:
           - se `!navigator.bluetooth` e `isSecureContext` for true → a página está num
             contexto seguro e mesmo assim não há API: a mensagem deve dizer que ESTE
             navegador não expõe Web Bluetooth, citar Chrome/Edge/Opera no desktop e
             Chrome no Android, e dizer que Brave e alguns builds de Chromium a mantêm
             desligada atrás de uma flag;
           - se `!navigator.bluetooth` e `isSecureContext` for false → a mensagem atual
             sobre HTTPS/localhost está certa e pode ficar;
           - não mudar a assinatura de `isSupported()`, que continua `!!navigator.bluetooth`
             e é API pública.
         Aplicar a mesma separação no aviso do `demo/index.html` (grep a mesma frase), que
         hoje tem o texto longo com o link do Bluefy — o ramo de contexto inseguro mantém
         o texto atual; o ramo de "navegador sem a API" ganha o texto novo, e o link do
         Bluefy continua fazendo sentido nos dois.
         Entrada em `CHANGELOG.md` sob `## [Unreleased]`, seção `### Fixed`, citando que a
         mensagem antiga apontava a causa errada e que isso apareceu num relato real.
Verify:  `node --check src/niimbot.js`, o gate de sintaxe dos blocos inline do demo descrito
         no `CLAUDE.md`, e um harness descartável em `test/` no padrão dos que já existem
         (o `globalThis.navigator` tem de existir ANTES do arquivo carregar; no Node >= 21
         use `Object.defineProperty`) que prove os dois ramos:
           - `navigator` sem `bluetooth` + `isSecureContext = true`  → mensagem NÃO cita HTTPS
           - `navigator` sem `bluetooth` + `isSecureContext = false` → mensagem cita HTTPS
         Cole a saída literal do harness no relatório.
