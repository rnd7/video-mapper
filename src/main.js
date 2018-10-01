const electron = require('electron')
const app = electron.app
const BrowserWindow = electron.BrowserWindow
const { ipcMain } = electron

var THREE = require('three')

const path = require('path')
const url = require('url')

let displayWindow

const createDisplayWindow = () => {
  displayWindow = new BrowserWindow({width: 640, height: 640})
  displayWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'displayWindow/index.html'),
    protocol: 'file:',
    slashes: true
  }))
  // Open the DevTools.
  //displayWindow.webContents.openDevTools()
  displayWindow.on('closed', function () {
    displayWindow = null
  })
}



const createWindows = () => {
  createDisplayWindow()
}

app.on('ready', createWindows)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function() {
  if (mainWindow === null) {
    createWindows()
  }
})
