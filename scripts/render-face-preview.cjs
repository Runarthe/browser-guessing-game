// Run with Electron. Renders local artwork only; does not start the game server.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:880,height:580,webPreferences:{offscreen:true}});
  await win.loadFile(path.join(__dirname,'../public/_preview_faces.html'));
  await win.webContents.executeJavaScript('document.fonts.ready');
  const image = await win.webContents.capturePage();
  const output = path.join(app.getPath('temp'),'confetti-expression-preview.png');
  fs.writeFileSync(output,image.toPNG());
  console.log(output);app.quit();
}).catch(err=>{console.error(err);app.exit(1);});
