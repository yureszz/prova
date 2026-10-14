// Teste de ponta a ponta: abre o programa de verdade, cadastra, fecha, reabre e confere.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'simcult-e2e-'));
  const abrir = () => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(__dirname, '..')],
    env: { ...process.env, APPDATA: appData, XDG_CONFIG_HOME: appData } });

  let app = await abrir(); app.process().stdout.on('data', d => process.stdout.write(String(d)));
  let w = await app.firstWindow();
  await w.waitForSelector('#total');
  w.on('console', m => console.log('PAGE:', m.text())); w.on('pageerror', e => console.log('PAGEERR:', e.message));
  console.log('título:', await w.title());
  await w.click('text=+ Nova manifestação');
  await w.fill('#nome', 'Festa de São João');
  await w.selectOption('#categoria', 'Festas e celebrações');
  await w.selectOption('#territorio', 'Sede');
  await w.fill('#local', 'Centro');
  await w.fill('#historia', 'Tradição antiga');
  const foto = path.join(appData, 'foto.png'); fs.writeFileSync(foto, PNG);
  const foto2 = path.join(appData, 'foto2.png'); fs.writeFileSync(foto2, PNG);
  await w.setInputFiles('#foto', [foto, foto2]);
  await w.waitForFunction(() => document.querySelectorAll('#miniaturas .thumb').length === 2);
  console.log('miniaturas no cadastro: 2');
  // diálogos nativos de mensagem bloqueiam; interceptamos no processo principal
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (j, o) => { console.log('MSG:', o.message); return 0; }; });
  await w.click('button[type=submit]');
  await w.waitForSelector('#consulta:not(.hide)');
  console.log('linhas:', await w.locator('#lista tr').count());
  await app.close();

  app = await abrir();
  w = await app.firstWindow();
  await w.waitForSelector('#total');
  await w.waitForFunction(() => document.getElementById('total').textContent === '1');
  await w.click('text=Consultar cadastros');
  console.log('após reiniciar:', await w.locator('#lista tr td').first().textContent());
  await w.click('#lista >> text=Ver ficha');
  const imgOk = await w.evaluate(() => { const i = document.querySelector('#detalheConteudo img'); return !!i && i.complete && i.naturalWidth > 0; });
  console.log('fotos carregadas na ficha:', await w.locator('#detalheConteudo img').count(), imgOk);
  await w.screenshot({ path: process.env.SHOT || '/tmp/simcult-ficha.png' });
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (j, o) => { console.log('MSG:', o.message); return 0; }; });
  // relatórios
  await w.click('text=Voltar');
  await w.click('nav >> text=Relatórios');
  for (const [valor, esperado] of [['categoria', 'Categoria: Festas e celebrações (1)'], ['local', 'Localidade: Centro (1)'], ['territorio', 'Território: Sede (1)'], ['fichas', 'Festa de São João']]) {
    await w.selectOption('#tipoRel', valor);
    const txt = await w.locator('#relatorioConteudo').textContent();
    console.log('relatório', valor, txt.includes(esperado) ? 'ok' : 'FALHOU: ' + txt.slice(0, 200));
  }
  await w.click('nav >> text=Consultar cadastros');
  await w.click('#lista >> text=Ver ficha');
  // PDF
  const pdf = path.join(appData, 'f.pdf');
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, pdf);
  await w.click('text=Salvar ficha em PDF');
  await w.waitForTimeout(1500);
  console.log('pdf bytes:', fs.existsSync(pdf) ? fs.statSync(pdf).size : 'NÃO GERADO');
  // excluir
  await w.click('text=Voltar');
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; });
  await w.click('#lista >> text=Excluir');
  await w.waitForFunction(() => document.getElementById('lista').textContent.includes('Nenhum cadastro'));
  console.log('excluído ok');
  await app.close();
  fs.rmSync(appData, { recursive: true, force: true });
})().catch(e => { console.error('FALHOU', e); process.exit(1); });
