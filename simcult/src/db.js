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
const MAX_FOTOS = 12;
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
      id TEXT PRIMARY KEY, ${colunas},
      criado TEXT NOT NULL DEFAULT '', atualizado TEXT NOT NULL DEFAULT '')`);
    this.db.run(`CREATE TABLE IF NOT EXISTS fotos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, manifestacao_id TEXT NOT NULL, arquivo TEXT NOT NULL, ordem INTEGER NOT NULL DEFAULT 0)`);
    // Migração: versões de teste guardavam uma única foto na coluna "foto".
    if (this.linhas('PRAGMA table_info(manifestacoes)').some(c => c.name === 'foto')) {
      this.linhas('SELECT id, foto FROM manifestacoes WHERE foto <> \'\'').forEach(l => {
        if (!this.linhas('SELECT 1 FROM fotos WHERE manifestacao_id = ?', [l.id]).length) {
          this.db.run('INSERT INTO fotos (manifestacao_id, arquivo, ordem) VALUES (?, ?, 0)', [l.id, l.foto]);
        }
      });
    }
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

  fotosDe(id) {
    return this.linhas('SELECT arquivo FROM fotos WHERE manifestacao_id = ? ORDER BY ordem, id', [id]).map(f => f.arquivo);
  }

  urlFoto(arquivo) { return pathToFileURL(path.join(this.fotosDir, arquivo)).href; }

  paraObjeto(l, fotos) {
    const o = { id: l.id };
    CAMPOS.forEach(c => { o[c] = l[c]; });
    const lista = fotos || this.fotosDe(l.id);
    o.imagens = lista.map(f => this.urlFoto(f));
    o.imagem = o.imagens[0] || '';
    o.criado = l.criado;
    o.atualizado = l.atualizado;
    return o;
  }

  listar() {
    const porId = {};
    this.linhas('SELECT manifestacao_id, arquivo FROM fotos ORDER BY ordem, id').forEach(f => {
      (porId[f.manifestacao_id] = porId[f.manifestacao_id] || []).push(f.arquivo);
    });
    return this.linhas('SELECT * FROM manifestacoes ORDER BY nome COLLATE NOCASE').map(l => this.paraObjeto(l, porId[l.id] || []));
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

  // Converte a lista enviada pela tela em nomes de arquivo: fotos novas (data:) são gravadas,
  // fotos já existentes (file:) só são aceitas se pertencerem ao próprio cadastro.
  resolverFotos(id, itens, existentes, novas) {
    return itens.map(item => {
      if (typeof item !== 'string') return null;
      if (item.startsWith('data:')) { const nome = this.gravarFoto(id, item); novas.push(nome); return nome; }
      let nome = '';
      try { nome = path.basename(decodeURIComponent(new URL(item).pathname)); } catch (e) { return null; }
      return existentes.includes(nome) ? nome : null;
    }).filter(Boolean);
  }

  salvar(r) {
    if (!r || typeof r.id !== 'string' || !r.id) throw new Error('Cadastro sem identificador.');
    OBRIGATORIOS.forEach(c => {
      if (typeof r[c] !== 'string' || !r[c].trim()) throw new Error(`Preencha o campo obrigatório: ${c}.`);
    });
    const itens = Array.isArray(r.imagens) ? r.imagens : (r.imagem ? [r.imagem] : []);
    if (itens.length > MAX_FOTOS) throw new Error(`Cada manifestação aceita até ${MAX_FOTOS} fotografias.`);
    const atual = this.linhas('SELECT * FROM manifestacoes WHERE id = ?', [r.id])[0];
    const antigas = this.fotosDe(r.id);
    const novas = [];
    let finais;
    try {
      finais = this.resolverFotos(r.id, itens, antigas, novas);
      const agora = new Date().toISOString();
      const valores = CAMPOS.map(c => String(r[c] == null ? '' : r[c]).trim());
      this.db.run('BEGIN');
      try {
        this.db.run(`INSERT OR REPLACE INTO manifestacoes (id, ${CAMPOS.join(', ')}, criado, atualizado)
          VALUES (?, ${CAMPOS.map(() => '?').join(', ')}, ?, ?)`, [r.id, ...valores, atual ? atual.criado : agora, agora]);
        this.db.run('DELETE FROM fotos WHERE manifestacao_id = ?', [r.id]);
        finais.forEach((arq, i) => this.db.run('INSERT INTO fotos (manifestacao_id, arquivo, ordem) VALUES (?, ?, ?)', [r.id, arq, i]));
        this.db.run('COMMIT');
      } catch (e) { this.db.run('ROLLBACK'); throw e; }
      this.persistir();
    } catch (e) {
      novas.forEach(f => this.removerFoto(f));
      throw e;
    }
    antigas.filter(f => !finais.includes(f)).forEach(f => this.removerFoto(f));
    return this.obter(r.id);
  }

  excluir(id) {
    const fotos = this.fotosDe(id);
    this.db.run('DELETE FROM fotos WHERE manifestacao_id = ?', [id]);
    this.db.run('DELETE FROM manifestacoes WHERE id = ?', [id]);
    this.persistir();
    fotos.forEach(f => this.removerFoto(f));
  }

  // Backup no mesmo formato JSON do SIMCULT em HTML (as fotos vão embutidas).
  exportarBackup() {
    const registros = this.listar().map(o => {
      const imagens = this.fotosDe(o.id).map(arq => {
        try {
          const ext = path.extname(arq).slice(1).toLowerCase();
          return `data:${EXT_MIME[ext] || 'image/jpeg'};base64,` + fs.readFileSync(path.join(this.fotosDir, arq)).toString('base64');
        } catch (e) { return null; } // foto ausente: exporta sem ela
      }).filter(Boolean);
      o.imagens = imagens;
      o.imagem = imagens[0] || ''; // compatível com a versão em HTML (uma foto)
      return o;
    });
    return JSON.stringify({ sistema: 'SIMCULT/SIRMC', versao: 3, data: new Date().toISOString(), registros }, null, 2);
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
    const antigas = this.linhas('SELECT arquivo FROM fotos').map(l => l.arquivo);
    const novas = [];
    try {
      const agora = new Date().toISOString();
      const itens = registros.map(r => {
        const imgs = (Array.isArray(r.imagens) ? r.imagens : (r.imagem ? [r.imagem] : []))
          .filter(i => typeof i === 'string' && i.startsWith('data:')).slice(0, MAX_FOTOS);
        const fotos = imgs.map(i => { const n = this.gravarFoto(r.id, i); novas.push(n); return n; });
        return { r, fotos, valores: [r.id, ...CAMPOS.map(c => String(r[c] == null ? '' : r[c]).trim()), r.criado || agora, r.atualizado || agora] };
      });
      this.db.run('BEGIN');
      try {
        this.db.run('DELETE FROM manifestacoes');
        this.db.run('DELETE FROM fotos');
        itens.forEach(({ r, fotos, valores }) => {
          this.db.run(`INSERT OR REPLACE INTO manifestacoes (id, ${CAMPOS.join(', ')}, criado, atualizado)
            VALUES (?, ${CAMPOS.map(() => '?').join(', ')}, ?, ?)`, valores);
          fotos.forEach((arq, i) => this.db.run('INSERT INTO fotos (manifestacao_id, arquivo, ordem) VALUES (?, ?, ?)', [r.id, arq, i]));
        });
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
