# niimbot

Driver **Web Bluetooth** e documentação de protocolo para impressoras de
etiqueta **Niimbot**, imprimindo direto do navegador — sem app intermediário.

Protocolo **V4** (linha D11 / B1 Pro / B21 Pro), obtido por engenharia reversa
e validado em hardware real na **Niimbot B1 Pro**.

## Conteúdo

| Caminho | O que é |
|---|---|
| `src/niimbot.js` | Driver genérico, sem dependências/build. Expõe `window.Niimbot`. |
| `registry.json` | Registro de modelos de impressora + tamanhos de etiqueta. |
| `docs/protocol-v4.md` | Documentação do protocolo V4 (opcodes, frame, fluxo, geometria). |
| `demo/index.html` | Demo standalone: parear e imprimir uma etiqueta de teste. |

## Uso rápido

```html
<script src="src/niimbot.js"></script>
<script>
  const model = { name_prefixes: ["B1"], density: 3, label_type: 1, speed: 1 };
  const size  = { w_px: 584, h_px: 354 };       // T50×30 (50×30mm @ 300dpi)
  if (Niimbot.isSupported()) {
    await Niimbot.printImage("/caminho/etiqueta.png", {
      model, size, onProgress: (s) => console.log(s),
    });
  }
</script>
```

A imagem deve ter exatamente `w_px × h_px`. O driver faz o threshold para 1-bit
(luminância < 128 = preto) e envia via BLE. Veja `registry.json` para os valores
de `model`/`size`.

- `Niimbot.printImage(url, { model, size, onProgress })`
- `Niimbot.printBatch([url1, url2, …], { model, size, onProgress })`
- `Niimbot.isSupported()` → `false` em Firefox/Safari (Web Bluetooth ausente)

## Requisitos

**Chrome/Edge** (Chromium) em **HTTPS** ou `localhost`. Web Bluetooth não existe
em Firefox/Safari.

## Demo

Sirva a pasta por HTTPS/localhost e abra `demo/index.html`:

```bash
python -m http.server 8000   # depois acesse http://localhost:8000/demo/
```

## Créditos

Protocolo obtido por engenharia reversa e validado em hardware na B1 Pro.
Referência externa da comunidade: [niim.blue](https://niim.blue) / niimbluelib.

## Licença

MIT — veja [LICENSE](LICENSE).
