# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-037  Let the caller override the per-model frame bundling
Why:     o D11_H manda uma escrita BLE por frame (`bundle: false`), e uma página de
         208 frames corta no papel enquanto páginas de 2, 20 e 51 frames saem inteiras.
         O app oficial imprime a mesma página, então o limite não é a impressora. Não dá
         para TESTAR bundling nesse modelo hoje: `_bundleAllowed` é decidido no connect a
         partir de `MODEL_IDS` e não tem override público.
Files:   src/niimbot.js, CHANGELOG.md, test/bundle.test.js (novo), CLAUDE.md
Do:      1. Em `src/niimbot.js`, junto de `_bundleAllowed` (grep o nome, a linha anda),
            adicione `let bundleOverride = null;` — `null` = usa o default do modelo,
            `true`/`false` = força.
         2. `sendBundled` passa a decidir por
            `const allowed = bundleOverride === null ? _bundleAllowed : bundleOverride;`
            e usa `allowed ? BUNDLE_MAX : 0` onde hoje lê `_bundleAllowed`. Nada mais
            muda: o frame continua sem ser partido, o teto continua BUNDLE_MAX.
         3. Exponha no objeto público `root.Niimbot`, ao lado de `WRITE_MODE` e seguindo
            o mesmo padrão dele:
              - `get BUNDLE()` / `set BUNDLE(v)` — aceita `null`, `true`, `false`;
                qualquer outro valor lança `TypeError` com mensagem que nomeia os três
                aceitos (NÃO aceite silenciosamente, é knob de diagnóstico).
              - `get DETECTED_BUNDLE()` → o `_bundleAllowed` do modelo conectado.
              - `get EFFECTIVE_BUNDLE()` → o booleano que `sendBundled` vai usar agora.
            Comente que é DIAGNÓSTICO: o default por modelo continua mandando, e só foi
            validado em B1 e M2-H.
         4. A linha de log do connect (a que hoje imprime `bundle=${_bundleAllowed}`)
            passa a imprimir `bundle=<efetivo> (detected=<do modelo>)`, no mesmo formato
            que ela já usa para `writeMode`/`override`/`effective`.
         5. `bundleOverride` NÃO é resetado no connect — igual ao `writeOverride`, que
            sobrevive para o testador poder fixar antes de conectar. Confirme no código
            do connect que nada zera ele e, se zerar, não zere.
Verify:  `node --check src/niimbot.js` e o novo harness, que roda sem impressora e sem
         navegador (stub de `navigator` ANTES do load — veja o topo de
         `test/pacing.test.js` e copie o padrão, inclusive o `Object.defineProperty`):
           node test/bundle.test.js
         Ele precisa cobrir, contando as CHAMADAS a `writeValueWithoutResponse` e os
         tamanhos de cada uma, numa página com muitas linhas distintas:
           a) modelo com `bundle:false` e `BUNDLE = null`  → uma escrita por frame
           b) o mesmo modelo com `BUNDLE = true`           → estritamente MENOS escritas
              que (a), e nenhuma escrita maior que BUNDLE_MAX
           c) modelo com `bundle:true` e `BUNDLE = false`  → uma escrita por frame
           d) `Niimbot.BUNDLE = "sim"`                     → lança TypeError
           e) `DETECTED_BUNDLE` e `EFFECTIVE_BUNDLE` divergem em (b) e em (c)
         Rode também, sem regressão: node test/pacing.test.js && node test/dispatch.test.js
         && node test/unconfirmed.test.js && node test/one-page-per-job.test.js
         Acrescente a linha do `test/bundle.test.js` na lista de Verify do `CLAUDE.md`.
         NÃO afirme que isso conserta impressão: nada aqui foi ao papel.
