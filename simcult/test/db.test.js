'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Banco } = require('../src/db');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const base = () => ({ id: 'r1', nome: 'Festa de São João', categoria: 'Festas e celebrações', territorio: 'Sede',
  local: 'Centro', data: 'junho', historia: 'Linha 1\nLinha "2"; com ponto e vírgula', imagem: PNG });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simcult-'));
  let b = await Banco.abrir(dir);
  assert.strictEqual(b.listar().length, 0);

  const s = b.salvar(base());
  assert.ok(s.imagem.startsWith('file:'));
  assert.strictEqual(fs.readdirSync(path.join(dir, 'fotos')).length, 1);

  // persistência: reabre o arquivo
  b = await Banco.abrir(dir);
  assert.strictEqual(b.listar().length, 1);
  assert.strictEqual(b.listar()[0].historia, base().historia);

  // editar mantendo a foto, depois trocando e removendo
  b.salvar({ ...b.obter('r1'), nome: 'Festa Junina' });
  assert.strictEqual(fs.readdirSync(path.join(dir, 'fotos')).length, 1);
  b.salvar({ ...b.obter('r1'), imagem: PNG });
  assert.strictEqual(fs.readdirSync(path.join(dir, 'fotos')).length, 1);
  b.salvar({ ...b.obter('r1'), imagem: '' });
  assert.strictEqual(fs.readdirSync(path.join(dir, 'fotos')).length, 0);
  b.salvar({ ...b.obter('r1'), imagem: PNG });

  assert.throws(() => b.salvar({ ...base(), id: 'x', nome: ' ' }));

  // CSV
  const csv = b.csv();
  assert.ok(csv.startsWith('﻿"Nome";'));
  assert.ok(csv.includes('Linha ""2""'));

  // backup e restauração
  const json = b.exportarBackup();
  b.salvar({ ...base(), id: 'r2', nome: 'Outra', imagem: '' });
  assert.strictEqual(b.listar().length, 2);
  const regs = Banco.lerBackup(json);
  assert.strictEqual(b.restaurar(regs).length, 1);
  assert.strictEqual(b.listar()[0].id, 'r1');
  assert.strictEqual(fs.readdirSync(path.join(dir, 'fotos')).length, 1);
  assert.throws(() => Banco.lerBackup('{"x":1}'));
  assert.throws(() => Banco.lerBackup('lixo'));

  // excluir
  b.excluir('r1');
  assert.strictEqual(b.listar().length, 0);
  assert.strictEqual(fs.readdirSync(path.join(dir, 'fotos')).length, 0);

  // cópia automática criada na reabertura
  await Banco.abrir(dir);
  assert.ok(fs.readdirSync(path.join(dir, 'copias-automaticas')).length >= 1);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK - todos os testes do banco passaram');
})().catch(e => { console.error(e); process.exit(1); });
