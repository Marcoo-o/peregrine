#!/usr/bin/env node
// A mail server that takes everything and sends nothing on: what the phone application sends in the demo ends up in scripts/demo/.state/received.txt, so that
// sending can be tried without a real account. SMTP with STARTTLS on port 2587 (the certificate that dovecot.sh made), any login is accepted.
//
//     node scripts/demo/sink.cjs [port]
//
// It uses the `smtp-server` package that the repository has already.
const { SMTPServer } = require('smtp-server')
const fs = require('node:fs')
const path = require('node:path')

const state = path.join(__dirname, '.state')
const port = Number(process.argv[2] ?? 2587)
const log = path.join(state, 'received.txt')

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: [],
  allowInsecureAuth: false,
  key: fs.readFileSync(path.join(state, 'key.pem')),
  cert: fs.readFileSync(path.join(state, 'cert.pem')),
  onAuth(auth, _session, callback) {
    callback(null, { user: auth.username })
  },
  onData(stream, session, callback) {
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => {
      const header = `\n===== ${new Date().toISOString()} from ${session.envelope.mailFrom.address} to ${session.envelope.rcptTo.map((r) => r.address).join(', ')} =====\n`
      fs.appendFileSync(log, header + Buffer.concat(chunks).toString('utf8') + '\n')
      callback()
    })
  }
})

server.on('error', (error) => console.error(`the sink: ${error.message}`))
server.listen(port, '0.0.0.0', () => console.log(`the sink listens on ${port}; what it receives is written to ${log}`))
