const log = require('electron-log')

log.transports.file.level = 'info'
log.transports.file.fileName = 'ai-player.log'
log.transports.console.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024

log.info('日志系统初始化')

module.exports = log
