const Koa = require('koa')
const koaCors = require('@koa/cors')
const koaBody = require('koa-body')
const koaJson = require('koa-json')
const Router = require('@koa/router')
const http = require('http')
const parser = require('mailparser').simpleParser
const SMTPServer = require('smtp-server').SMTPServer
const fs = require('fs')
const path = require('path')

const render = (data) => {
  return `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <link rel="icon" href="/favicon.ico" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="never">
  <title>email hub</title>
  <style>
    body{
      font-size:14px;color:rgba(0,0,0,.85);padding:25px;
    }
    a{
      color:#15c;padding:8px;
      display:block;
    }

    .header{
      text-align:center;
    }
    .title{
      font-family: Roboto,RobotoDraft,Helvetica,Arial,sans-serif;
      font-size: 22px;
      font-variant-ligatures: no-contextual;
      color: #1f1f1f;
      font-weight: 400;
      line-height:1em;
      font-size: 26px;
      margin: 14px 0;
    }

    p{
      line-height:1.8em;
      font-size:14px;
    }

    .from{
      font-size:12px;color:rgba(0,0,0,.5);
      margin-bottom:20px;
      display:flex;
      aligns-item:center;
      align-items: center;
      justify-content: center;
    }

    .date{
      margin-left:16px;
      font-size:12px;
    }
    .mail-content{

    }
  </style>
</head>

<body>
  ${data}
</body>

</html>
  `
}
const createStorage = (configFile) => {
  let state = {}
  try {
    state = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  } catch (e) {

  }
  let handler
  const get = (key) => {
    return key ? state[key] : state
  }

  const set = (key, value) => {
    state[key] = value
    save()
  }

  const remove = (key) => {
    delete state[key]
    save()
  }

  const save = () => {
    if (handler) clearTimeout(handler)
    handler = setTimeout(() => {
      fs.writeFileSync(configFile, JSON.stringify(state))
    }, 0)
  }

  return { get, set, remove, save }
}

const createRouter = (api, appConfig) => {

  const router = new Router()
  const auth = async (ctx, next) => {}

  router
    .get('/mails/:to', async (ctx) => {
      let { to } = ctx.params
      let output = ctx.query.output || 'html'
      let data = api.get(to)
      if (output == 'html') {
        let count = data.length
        ctx.body = render('<ol>' + [...data].reverse().map((i, idx) => `<li><a href="/mail/${to}/${count - idx}">${i.date}  ${i.subject}</a></li>`).join('') + '</ol>')
      } else {
        ctx.body = data
      }
    })

    .get('/mail/:to/:idx', async (ctx) => {
      let { to, idx } = ctx.params
      let data = api.get(to)
      let email = data[idx - 1]
      let output = ctx.query.output || 'html'
      if (output == 'html') {
        ctx.body = render(`
        <div class="header">
          <div class="title">${email.subject}</div>
          <div class="from"><span>${email.from.replace('<', '&lt;').replace('>', '&gt;')}</span><span class="date">${email.date}</span></div>
        </div>
        <div class="mail-content"></div>
        <script>
          var shadowHost = document.querySelector('.mail-content');
          var shadowRoot = shadowHost.attachShadow({
            mode: 'open'
          });
          shadowRoot.innerHTML = decodeURIComponent("${encodeURIComponent(email.content)}");
        </script >
  `)
      } else {
        ctx.body = email
      }

    })

    .get('/', async (ctx) => {
      ctx.body = {
        mails: '/mails/{email}'
      }
    })


  return router
}

class Server {
  constructor(api, appConfig) {
    this.modules = []
    this.api = api
    this.appConfig = appConfig

    const app = new Koa()
    app.use(koaCors())
    app.use(koaBody())
    app.use(koaJson())

    app.use(async (ctx, next) => {
      try {
        await next()
      } catch (error) {
        console.log(error)
        if (error instanceof Error) {
          ctx.body = { error: { message: error.message } }
        } else {
          ctx.body = { error }
        }
      }
    })

    this.app = app
    this.start()
  }

  startSTMP() {
    const server = new SMTPServer({
      onMailFrom(address, session, callback) {
        // console.log(address.address)
        //
        return callback(); // Accept the address
        return callback(
          new Error("Only allowed@example.com is allowed to send mail")
        );
      },
      onData: (stream, session, callback) => {
        parser(stream, {}, (err, parsed) => {
          if (err) {
            console.log(err)
          } else {
            this.api.save(parsed)
          }
        })
        stream.on("end", callback);
      },
      disabledCommands: ['AUTH']
    })

    server.listen(25)
  }

  start() {
    let router = createRouter(this.api, this.appConfig)

    this.app
      .use(router.routes())
      .use(router.allowedMethods());

    const server = http.createServer(this.app.callback())

    server.on('error', (e) => {
      console.log(e)
    })

    const port = process.env.PORT || this.appConfig.port || 30002
    server.listen(port, () => {
      console.log('start 0.0.0.0:' + port)
    })

    this.startSTMP()
  }
}

class Controller {
  constructor() {
    this.store = createStorage('./db.json')
  }

  get(email) {
    return this.store.get(email) || []
  }

  save(data) {
    let subject = data.subject
    let to = data.to.text
    let date = data.date
    let from = data.from.text
    let content = data.html || data.textAsHtml || data.text

    let current = this.store.get(to)
    if (!current) {
      current = []
    }
    current.push({ subject, from, to, content, date: date.toISOString() })
    this.store.set(to, current)
  }

}

new Server(new Controller(), {
  port: 30002
})
