'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { Banco } = require('./db');

app.setPath('userData', path.join(app.getPath('appData'), 'SIMCULT'));
if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;
let banco = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'SIMCULT | Medeiros Neto', backgroundColor: '#f1f5f9', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  janela.once('ready-to-show', () => janela.show());
  janela.on('page-title-updated', e => e.preventDefault());
  janela.webContents.on('will-navigate', e => e.preventDefault());
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.loadFile(path.join(__dirname, 'index.html'));
  janela.on('closed', () => { janela = null; });
}

function tratar(canal, fn) {
  ipcMain.handle(canal, async (_e, ...args) => {
    try { return await fn(...args); } catch (e) { return { __erro: e.message || String(e) }; }
  });
}

async function escolherArquivoParaSalvar(nome, filtros) {
  const r = await dialog.showSaveDialog(janela, { defaultPath: path.join(app.getPath('documents'), nome), filters: filtros });
  return r.canceled ? null : r.filePath;
}

function carimbo() { return new Date().toISOString().slice(0, 10); }

function registrarIpc() {
  ipcMain.on('alerta', (e, msg) => {
    dialog.showMessageBoxSync(janela, { type: 'info', title: 'SIMCULT', message: String(msg), buttons: ['OK'] });
    e.returnValue = true;
  });
  ipcMain.on('confirmar', (e, msg) => {
    e.returnValue = dialog.showMessageBoxSync(janela, {
      type: 'question', title: 'SIMCULT', message: String(msg), buttons: ['Sim', 'Não'], defaultId: 1, cancelId: 1
    }) === 0;
  });

  tratar('info', () => ({ pasta: banco.dir, versao: app.getVersion() }));
  tratar('listar', () => banco.listar());
  tratar('salvar', r => banco.salvar(r));
  tratar('excluir', id => { banco.excluir(id); return true; });

  tratar('backup', async () => {
    const destino = await escolherArquivoParaSalvar(`SIMCULT_backup_${carimbo()}.json`, [{ name: 'Backup SIMCULT (JSON)', extensions: ['json'] }]);
    if (!destino) return { ok: false };
    fs.writeFileSync(destino, banco.exportarBackup(), 'utf8');
    return { ok: true, caminho: destino };
  });

  tratar('restaurar', async () => {
    const r = await dialog.showOpenDialog(janela, { title: 'Escolha o arquivo de backup', properties: ['openFile'],
      filters: [{ name: 'Backup SIMCULT (JSON)', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    const registros = Banco.lerBackup(fs.readFileSync(r.filePaths[0], 'utf8'));
    const resp = dialog.showMessageBoxSync(janela, { type: 'warning', title: 'SIMCULT', buttons: ['Restaurar', 'Cancelar'],
      defaultId: 1, cancelId: 1, message: `Substituir TODOS os cadastros atuais pelos ${registros.length} registros do backup?`,
      detail: 'Uma cópia automática dos dados atuais fica guardada na pasta "copias-automaticas" do programa.' });
    if (resp !== 0) return { ok: false };
    banco.copiaAutomatica();
    return { ok: true, registros: banco.restaurar(registros) };
  });

  tratar('csv', async () => {
    const destino = await escolherArquivoParaSalvar('SIMCULT_registros.csv', [{ name: 'Planilha CSV', extensions: ['csv'] }]);
    if (!destino) return { ok: false };
    fs.writeFileSync(destino, banco.csv(), 'utf8');
    return { ok: true, caminho: destino };
  });

  tratar('imprimir', () => new Promise(resolve => {
    janela.webContents.print({ silent: false, printBackground: true }, ok => resolve({ ok }));
  }));

  tratar('pdf', async nome => {
    const limpo = String(nome || 'SIMCULT').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
    const destino = await escolherArquivoParaSalvar(`${limpo}.pdf`, [{ name: 'Documento PDF', extensions: ['pdf'] }]);
    if (!destino) return { ok: false };
    const dados = await janela.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(destino, dados);
    return { ok: true, caminho: destino };
  });
}

app.on('second-instance', () => {
  if (janela) { if (janela.isMinimized()) janela.restore(); janela.focus(); }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    banco = await Banco.abrir(app.getPath('userData'));
  } catch (e) {
    dialog.showErrorBox('SIMCULT', 'Não foi possível abrir o banco de dados.\n\n' + e.message +
      '\n\nPasta de dados: ' + app.getPath('userData'));
    app.quit();
    return;
  }
  registrarIpc();
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
