# Protocolo Niimbot V4 (linha D11 / B1 Pro / B21 Pro)

Obtido por **engenharia reversa** e validado em laboratório na **Niimbot B1
Pro**. Compatível com a linha D110_M / D11_H / B1 Pro / B21 Pro.

## Transporte (Web Bluetooth / BLE GATT)

| Item | Valor |
|---|---|
| Service UUID | `e7810a71-73ae-499d-8c15-faa9aef0c3f2` |
| Characteristic UUID | `bef8d6c9-9c21-4c9e-b632-bd58c1009f9f` |
| Propriedades | `NOTIFY` + `WRITE_NO_RESPONSE` |
| Pacote inicial de conexão (raw) | `03 55 55 C1 01 01 C1 AA AA` |

Filtragem do dispositivo: nome anunciado começa com `B1` / `B2` / `D1`.

**Restrições do navegador:** Web Bluetooth exige **HTTPS** (ou `localhost`) e um
gesto do usuário (clique). Funciona em **Chrome/Edge** (e Chromium em geral);
**não existe** em Firefox/Safari.

## Frame de pacote

```
[0x55, 0x55, cmd, len, ...data, crc, 0xAA, 0xAA]
crc = cmd XOR len XOR (todos os bytes de data)
```

As respostas chegam por NOTIFY no mesmo frame (`0x55 0x55 cmd len ... crc 0xAA 0xAA`).

## Opcodes

| Cmd | Nome | Resposta | Observação |
|---|---|---|---|
| `0x21` | SetDensity | `0x31` | data = `[density]` (1–3; 3 = mais escuro) |
| `0x23` | SetLabelType | `0x33` | data = `[1]` (com gaps) |
| `0x01` | PrintStart | `0x02` | data = `[00 01 00 00 00 00 00 speed 00]` (9 bytes; speed 0/1) |
| `0xA3` | PrintStatus | `0xB3` | data = `[1]`. Resposta: `page(u16 BE), print%, feed%` |
| `0x13` | SetPageSize | `0x14` | data = `[H_hi H_lo W_hi W_lo 00 01 00×7]` (13 bytes) |
| `0x84` | PrintEmptyRow | — | data = `[row_hi, row_lo, run]` (linha em branco) |
| `0x85` | PrintBitmapRow | — | data = `[row_hi, row_lo, 0, total_lo, total_hi, run, ...stride]` |
| `0xE3` | PrintEnd (página) | `0xE4` | data = `[1]` |
| `0xF3` | PrintEnd | `0xF4` | data = `[1]` |

`H` = altura (eixo de avanço, nº de linhas), `W` = largura (eixo do printhead).
`total` = nº de bits pretos na linha. `run` = quantas linhas idênticas
consecutivas (run-length, máx. 200). `stride = ceil(W / 8)` bytes por linha,
**MSB-first** (bit 0x80 = pixel mais à esquerda; 1 = preto).

## Fluxo de impressão (uma etiqueta)

```
connect()                              # GATT + pacote de conexão 0x03…
SetDensity(0x21,[density])      -> 0x31
SetLabelType(0x23,[1])          -> 0x33
PrintStart(0x01,[…,speed,…])    -> 0x02
PrintStatus(0xA3,[1])  (one-way, sem esperar)  + ~30 ms   # workaround B21 Pro
SetPageSize(0x13,[H,W,…])       -> 0x14
para cada linha:
    vazia  -> PrintEmptyRow(0x84,[row, run])
    pixels -> PrintBitmapRow(0x85,[row, 0, total, run, ...bitmap])
PrintEnd-página(0xE3,[1])       -> 0xE4
loop: PrintStatus(0xA3,[1]) -> 0xB3 até page >= 1   (timeout ~25 s)  # CRÍTICO
PrintEnd(0xF3,[1])              -> 0xF4
```

> **Por que o poll é crítico:** sem aguardar `page >= 1`, o `PrintEnd` chega no
> meio da impressão e a etiqueta sai **cortada**.

## Geometria de etiquetas (calibrado @ 300 dpi)

| Código | Impressora | w_px | h_px | stride |
|---|---|---|---|---|
| `T50*30` | B1 Pro | 584 | 354 | 73 |
| `T30*45+50` | B1 Pro (cable flag) | 354 | 1122 | 45 |
| `T15*50` | D11_H | 136 | 590 | 17 |
| `T12.5*74+35` | D11_H (cable flag) | 136 | 1287 | 17 |

300 dpi ≈ 11,81 px/mm. Pacote `SetPageSize` recebe `H` (linhas) e depois `W`.

## Encoding do bitmap

1-bit monocromático, **sem dithering** (threshold por luminância < 128 = preto).
Empacotamento por linha, MSB-first, `stride = ceil(W/8)` bytes. Linhas iguais
consecutivas são agrupadas por run-length (`run`), e linhas em branco usam o
opcode dedicado `0x84` — reduz drasticamente o nº de pacotes BLE.

## Referências

- Comunidade / outra implementação: niim.blue / niimbluelib (`@mmote/niimbluelib`).
