'use strict';
// Banco de dados local do SIMCULT (SQLite via sql.js, sem componentes nativos).
// O arquivo fica na pasta de dados do usuário; as fotos ficam na subpasta "fotos".
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const CAMPOS = ['nome', 'categoria', 'territorio', 'local', 'endereco', 'data', 'frequencia', 'patrimonio',
  'responsavel', 'contato', 'inicio', 'situacao', 'historia', 'descricao', 'fontes'];
const OBRIGATORIOS = ['nome', 'categoria', 'territorio', 'local'];
const CABECALHO_CSV = ['Nome', 'Categoria', 'Território', 'Localidade', 'Endereço', 'Data/período', 'Periodicidade',
  'Patrimônio', 'Responsável', 'Contato', 'Origem', 'Situação', 'Histórico', 'Descrição', 'Fontes'];
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const EXT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function carregarSqlJs() {
  const initSqlJs = require('sql.js');
  const wasmBinary = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
  return initSqlJs({ wasmBinary });
}

class Banco {
  static async abrir(dir) {
    fs.mkdirSync(path.join(dir, 'fotos'), { recursive: true });
    const SQL = await carregarSqlJs();
    const arquivo = path.join(dir, 'simcult.db');
    const b = new Banco(SQL, dir, arquivo);
    if (fs.existsSync(arquivo)) {
      b.copiaAutomatica();
      b.db = new SQL.Database(fs.readFileSync(arquivo));
    } else {
      b.db = new SQL.Database();
    }
    b.criarTabelas();
    b.persistir();
    return b;
  }

  constructor(SQL, dir, arquivo) {
    this.SQL = SQL;
    this.dir = dir;
    this.arquivo = arquivo;
    this.fotosDir = path.join(dir, 'fotos');
  }

  criarTabelas() {
    const colunas = CAMPOS.map(c => `${c} TEXT NOT NULL DEFAULT ''`).join(', ');
    this.db.run(`CREATE TABLE IF NOT EXISTS manifestacoes (
      id TEXT PRIMARY KEY, ${colunas}, foto TEXT NOT NULL DEFAULT '',
      criado TEXT NOT NULL DEFAULT '', atualizado TEXT NOT NULL DEFAULT '')`);
  }

  // Grava o banco inteiro de forma atômica: arquivo temporário + renomear.
  persistir() {
    const tmp = this.arquivo + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.arquivo);
  }

  // Mantém as 10 últimas cópias automáticas, feitas na abertura do programa.
  copiaAutomatica() {
    try {
      const pasta = path.join(this.dir, 'copias-automaticas');
      fs.mkdirSync(pasta, { recursive: true });
      const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(this.arquivo, path.join(pasta, `simcult-${carimbo}.db`));
      const antigas = fs.readdirSync(pasta).filter(f => f.endsWith('.db')).sort();
      antigas.slice(0, Math.max(0, antigas.length - 10)).forEach(f => fs.unlinkSync(path.join(pasta, f)));
    } catch (e) { /* a cópia automática nunca deve impedir o uso do programa */ }
  }

  linhas(sql, params) {
    const st = this.db.prepare(sql);
    try {
      if (params) st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  }

  paraObjeto(l) {
    const o = { id: l.id };
    CAMPOS.forEach(c => { o[c] = l[c]; });
    o.imagem = l.foto ? pathToFileURL(path.join(this.fotosDir, l.foto)).href : '';
    o.criado = l.criado;
    o.atualizado = l.atualizado;
    return o;
  }

  listar() {
    return this.linhas('SELECT * FROM manifestacoes ORDER BY nome COLLATE NOCASE').map(l => this.paraObjeto(l));
  }

  obter(id) {
    const l = this.linhas('SELECT * FROM manifestacoes WHERE id = ?', [id])[0];
    return l ? this.paraObjeto(l) : null;
  }

  gravarFoto(id, dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m) throw new Error('Fotografia em formato inválido.');
    const nome = `${id.replace(/[^\w-]/g, '_')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${MIME_EXT[m[1]]}`;
    fs.writeFileSync(path.join(this.fotosDir, nome), Buffer.from(m[2], 'base64'));
    return nome;
  }

  removerFoto(nome) {
    if (!nome) return;
    try { fs.unlinkSync(path.join(this.fotosDir, path.basename(nome))); } catch (e) { /* já removida */ }
  }

  salvar(r) {
    if (!r || typeof r.id !== 'string' || !r.id) throw new Error('Cadastro sem identificador.');
    OBRIGATORIOS.forEach(c => {
      if (typeof r[c] !== 'string' || !r[c].trim()) throw new Error(`Preencha o campo obrigatório: ${c}.`);
    });
    const atual = this.linhas('SELECT * FROM manifestacoes WHERE id = ?', [r.id])[0];
    const antiga = atual ? atual.foto : '';
    let foto = antiga;
    if (typeof r.imagem === 'string' && r.imagem.startsWith('data:')) foto = this.gravarFoto(r.id, r.imagem);
    else if (!r.imagem) foto = '';
    const agora = new Date().toISOString();
    const valores = CAMPOS.map(c => String(r[c] == null ? '' : r[c]).trim());
    try {
      this.db.run(`INSERT OR REPLACE INTO manifestacoes (id, ${CAMPOS.join(', ')}, foto, criado, atualizado)
        VALUES (?, ${CAMPOS.map(() => '?').join(', ')}, ?, ?, ?)`,
      [r.id, ...valores, foto, atual ? atual.criado : agora, agora]);
      this.persistir();
    } catch (e) {
      if (foto !== antiga) this.removerFoto(foto);
      throw e;
    }
    if (foto !== antiga) this.removerFoto(antiga);
    return this.obter(r.id);
  }

  excluir(id) {
    const atual = this.linhas('SELECT foto FROM manifestacoes WHERE id = ?', [id])[0];
    this.db.run('DELETE FROM manifestacoes WHERE id = ?', [id]);
    this.persistir();
    if (atual) this.removerFoto(atual.foto);
  }

  // Backup no mesmo formato JSON do SIMCULT em HTML (as fotos vão embutidas).
  exportarBackup() {
    const registros = this.linhas('SELECT * FROM manifestacoes ORDER BY nome COLLATE NOCASE').map(l => {
      const o = this.paraObjeto(l);
      o.imagem = '';
      if (l.foto) {
        try {
          const ext = path.extname(l.foto).slice(1).toLowerCase();
          o.imagem = `data:${EXT_MIME[ext] || 'image/jpeg'};base64,` +
            fs.readFileSync(path.join(this.fotosDir, l.foto)).toString('base64');
        } catch (e) { /* foto ausente: exporta sem imagem */ }
      }
      return o;
    });
    return JSON.stringify({ sistema: 'SIMCULT/SIRMC', versao: 2, data: new Date().toISOString(), registros }, null, 2);
  }

  static lerBackup(texto) {
    let obj;
    try { obj = JSON.parse(texto); } catch (e) { throw new Error('Arquivo de backup inválido ou danificado.'); }
    if (!obj || obj.sistema !== 'SIMCULT/SIRMC' || !Array.isArray(obj.registros) ||
      !obj.registros.every(r => r && typeof r.id === 'string' && typeof r.nome === 'string' &&
        typeof r.categoria === 'string' && typeof r.local === 'string')) {
      throw new Error('Arquivo de backup inválido ou danificado.');
    }
    return obj.registros;
  }

  // Substitui todos os cadastros. As fotos novas são gravadas antes; as antigas só são apagadas no fim.
  restaurar(registros) {
    const antigas = this.linhas('SELECT foto FROM manifestacoes').map(l => l.foto);
    const novas = [];
    try {
      const agora = new Date().toISOString();
      const itens = registros.map(r => {
        const foto = typeof r.imagem === 'string' && r.imagem.startsWith('data:') ? this.gravarFoto(r.id, r.imagem) : '';
        if (foto) novas.push(foto);
        return [r.id, ...CAMPOS.map(c => String(r[c] == null ? '' : r[c]).trim()), foto, r.criado || agora, r.atualizado || agora];
      });
      this.db.run('BEGIN');
      try {
        this.db.run('DELETE FROM manifestacoes');
        itens.forEach(v => this.db.run(`INSERT OR REPLACE INTO manifestacoes (id, ${CAMPOS.join(', ')}, foto, criado, atualizado)
          VALUES (?, ${CAMPOS.map(() => '?').join(', ')}, ?, ?, ?)`, v));
        this.db.run('COMMIT');
      } catch (e) { this.db.run('ROLLBACK'); throw e; }
      this.persistir();
    } catch (e) {
      novas.forEach(f => this.removerFoto(f));
      throw e;
    }
    antigas.forEach(f => this.removerFoto(f));
    return this.listar();
  }

  csv() {
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const linhas = [CABECALHO_CSV.map(esc).join(';'),
      ...this.linhas('SELECT * FROM manifestacoes ORDER BY nome COLLATE NOCASE').map(l => CAMPOS.map(c => esc(l[c])).join(';'))];
    return '﻿' + linhas.join('\r\n');
  }
}

module.exports = { Banco, CAMPOS };
