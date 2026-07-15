const dgram = require('dgram')
const http = require('http')
const { getLanIp } = require('./utils')

class DlnaReceiver {
  constructor() {
    this.ssdpSocket = null
    this.httpServer = null
    this.port = 18903
    this.udn = 'uuid:aiplayer-' + Date.now()
    this.onPlay = null
  }

  start() {
    this.startHttp()
    this.startSsdp()
    this.notifyTimer = setInterval(() => this.notify(), 30000)
    this.notify()
    return `http://${getLanIp()}:${this.port}`
  }

  startHttp() {
    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res))
    this.httpServer.listen(this.port)
  }

  startSsdp() {
    this.ssdpSocket = dgram.createSocket('udp4')
    this.ssdpSocket.bind(1900, () => {
      try { this.ssdpSocket.addMembership('239.255.255.250') } catch {}
      this.ssdpSocket.setBroadcast(true)
    })
    this.ssdpSocket.on('message', (msg, rinfo) => {
      if (msg.toString().includes('M-SEARCH')) {
        this.respondToSearch(rinfo)
      }
    })
    this.ssdpSocket.on('error', () => {})
  }

  respondToSearch(rinfo) {
    const ip = getLanIp()
    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'LOCATION: http://' + ip + ':' + this.port + '/device.xml',
      'SERVER: AIPlayer/1.0 UPnP/1.1',
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
      'USN: ' + this.udn + '::urn:schemas-upnp-org:device:MediaRenderer:1',
      '',
      ''
    ].join('\r\n')
    try { this.ssdpSocket.send(response, rinfo.port, rinfo.address) } catch {}
  }

  notify() {
    const ip = getLanIp()
    const msg = [
      'NOTIFY * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'LOCATION: http://' + ip + ':' + this.port + '/device.xml',
      'NT: urn:schemas-upnp-org:device:MediaRenderer:1',
      'NTS: ssdp:alive',
      'USN: ' + this.udn + '::urn:schemas-upnp-org:device:MediaRenderer:1',
      '',
      ''
    ].join('\r\n')
    try { this.ssdpSocket.send(msg, 1900, '239.255.255.250') } catch {}
  }

  handleHttp(req, res) {
    if (req.url === '/device.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(this.deviceXml())
    } else if (req.url.includes('/AVTransport/control') || req.url.includes('/RenderingControl/control')) {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const urlMatch = body.match(/<CurrentURI>([^<]+)<\/CurrentURI>/)
        if (urlMatch && this.onPlay) {
          this.onPlay(decodeURIComponent(urlMatch[1]))
        }
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
        res.end('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:SetAVTransportURIResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"/></s:Body></s:Envelope>')
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  }

  deviceXml() {
    return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>AI播放器</friendlyName>
    <manufacturer>AIPlayer</manufacturer>
    <UDN>${this.udn}</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <controlURL>/AVTransport/control</controlURL>
        <eventSubURL>/AVTransport/event</eventSubURL>
        <SCPDURL>/AVTransport/scpd.xml</SCPDURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <controlURL>/RenderingControl/control</controlURL>
        <eventSubURL>/RenderingControl/event</eventSubURL>
        <SCPDURL>/RenderingControl/scpd.xml</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`
  }

  stop() {
    if (this.notifyTimer) clearInterval(this.notifyTimer)
    if (this.ssdpSocket) this.ssdpSocket.close()
    if (this.httpServer) this.httpServer.close()
  }
}

module.exports = { DlnaReceiver }
