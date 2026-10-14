# SIMCULT / SIRMC — Sistema Municipal de Memória Cultural
Secretaria Municipal de Cultura de Medeiros Neto – Bahia

Programa desktop para Windows 7, 8, 10 e 11 (Electron 22 + banco SQLite local). Funciona sem internet,
abre em janela própria e grava tudo em `%APPDATA%\SIMCULT` (banco `simcult.db` + pasta `fotos`).

## Para o usuário
1. Execute `SIMCULT-Instalador-1.0.0-x64.exe` (Windows de 64 bits) ou `...-ia32.exe` (32 bits).
2. O ícone **SIMCULT** é criado na área de trabalho.
3. Os dados permanecem ao desinstalar/atualizar. Cópias automáticas dos 10 últimos usos ficam em `copias-automaticas`.

Cadastros com várias fotos, fichas individuais, relatórios (geral, por categoria, localidade, território, patrimônio, situação, periodicidade e fichas completas), impressão/PDF, CSV (`;` com acentos para o Excel) e backup/restauração em JSON
(compatível com os backups da versão em HTML).

## Para quem desenvolve
```
cd simcult
npm install
npm start          # abre o programa
npm test           # testes do banco de dados
npm run dist       # gera o instalador (precisa ser executado no Windows)
```
O instalador também é gerado automaticamente pelo GitHub Actions (`Actions > Gerar instalador SIMCULT (Windows)`),
e fica disponível como *artifact* ao final da execução.
Para Windows 7/8 a versão do Electron deve permanecer em 22.x.
