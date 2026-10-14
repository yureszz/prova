'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function chamar(canal, ...args) {
  const r = await ipcRenderer.invoke(canal, ...args);
  if (r && r.__erro) throw new Error(r.__erro);
  return r;
}

contextBridge.exposeInMainWorld('api', {
  info: () => chamar('info'),
  listar: () => chamar('listar'),
  salvar: r => chamar('salvar', r),
  excluir: id => chamar('excluir', id),
  backup: () => chamar('backup'),
  restaurar: () => chamar('restaurar'),
  csv: () => chamar('csv'),
  imprimir: () => chamar('imprimir'),
  pdf: nome => chamar('pdf', nome),
  alerta: msg => ipcRenderer.sendSync('alerta', msg),
  confirmar: msg => ipcRenderer.sendSync('confirmar', msg)
});
